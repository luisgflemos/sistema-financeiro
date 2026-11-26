"""Análise local de toda a base, com evidência separada por campo e sem gravações."""

import re
import unicodedata
from collections import Counter
from decimal import Decimal

from sqlalchemy import text

from app.customer_identity import prioritize_customer, resolve_customer
from app.transactions import LATEST

FIELDS = (
    "category_id",
    "subcategory_id",
    "cost_center_id",
    "party_id",
    "customer_group_id",
)


def normalized(value):
    value = "".join(
        c
        for c in unicodedata.normalize("NFD", str(value or "").lower())
        if not unicodedata.combining(c)
    )
    return " ".join(re.findall(r"[a-z0-9]+", value))


def description_key(value):
    """Preserva nomes/documentos; remove só referência variável de cobrança bancária."""
    value = normalized(value)
    if value.startswith("cr cob bloq comp conf recebimento "):
        return re.sub(r"(?: \d+)+$", "", value)
    return value


def description_evidence(history, target, identity, candidates):
    key = description_key(target.get("raw_description"))
    related = [
        row
        for row in history
        if key
        and description_key(row.get("raw_description")) == key
        and row.get("movement_kind") == "NORMAL"
        and (not target.get("account_id") or str(row["account_id"]) == str(target["account_id"]))
        and (not target.get("direction") or row["direction"] == target["direction"])
        and (not target.get("id") or str(row.get("source_transaction_id")) != str(target["id"]))
    ]
    result = {
        "party_candidates": sorted(candidates),
        "customer_identity": identity,
        "matching_records": len(related),
        "match_basis": {"bank_description": len(related)} if related else {},
        "same_bank_account": bool(target.get("account_id")),
        "direction": target.get("direction"),
        "fields": {},
        "limitation": "Padrão da descrição bancária. Cliente não é pré-requisito; conta não determina centro de custos. Todas as sugestões exigem confirmação.",
    }
    for field in FIELDS:
        counts = Counter(str(row.get(field) or "") for row in related)
        missing = counts.pop("", 0)
        result["fields"][field] = {
            "observations": len(related),
            "missing": missing,
            "values": dict(counts),
            "unanimous": len(counts) == 1 and sum(counts.values()) == len(related),
        }
    return result, related


def load_history(connection, org):
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
        SELECT t.account_id,t.direction,t.raw_description,t.posted_on,t.amount,i.*,
            t.id AS source_transaction_id
        FROM active_bank_transactions t JOIN bank_accounts a ON a.id=t.account_id
    """
                + LATEST
                + " WHERE a.organization_id=:org ORDER BY t.posted_on DESC,t.id"
            ),
            {"org": org},
        ).mappings()
    ]


def confirmed(rows):
    return [row for row in rows if row.get("method") in ("OPERATOR", "AI_CONFIRMED")]


def document_candidates(row, documents):
    found = re.findall(r"(?<!\d)\d{11,14}(?!\d)", str(row.get("raw_description", "")))
    return sorted({str(party) for document in found for party in documents.get(document, [])})


def full_overview(rows):
    learned = confirmed(rows)
    dates = [str(row["posted_on"]) for row in rows if row.get("posted_on")]
    monthly = {}
    for row in rows:
        if row.get("posted_on"):
            key = (str(row["posted_on"])[:7], row["direction"])
            value = monthly.setdefault(
                key,
                {
                    "records": 0,
                    "bank_amount": Decimal(0),
                    "identified_normal_amount": Decimal(0),
                },
            )
            value["records"] += 1
            value["bank_amount"] += Decimal(str(row["amount"]))
            if row.get("method") and row.get("movement_kind") == "NORMAL":
                value["identified_normal_amount"] += Decimal(str(row["amount"]))
    return {
        "records_scanned": len(rows),
        "confirmed_learning_records": len(learned),
        "pending_records": sum(not row.get("method") for row in rows),
        "automatic_records_not_used_as_training": sum(
            row.get("method") == "PATTERN" for row in rows
        ),
        "first_date": min(dates, default=None),
        "last_date": max(dates, default=None),
        "bank_credit": f"{sum((Decimal(str(row['amount'])) for row in rows if row['direction'] == 'CREDIT'), Decimal(0)):.2f}",
        "bank_debit": f"{sum((Decimal(str(row['amount'])) for row in rows if row['direction'] == 'DEBIT'), Decimal(0)):.2f}",
        "bank_totals_include_neutral_processes": True,
        "monthly": [
            {
                "month": month,
                "direction": direction,
                "records": value["records"],
                "bank_amount": f"{value['bank_amount']:.2f}",
                "identified_normal_amount": f"{value['identified_normal_amount']:.2f}",
            }
            for (month, direction), value in sorted(monthly.items())
        ],
        "confirmed_field_distributions": {
            field: dict(Counter(str(row.get(field) or "MISSING") for row in learned))
            for field in FIELDS
        },
        "identification_methods": dict(
            Counter(str(row.get("method") or "PENDING") for row in rows)
        ),
        "policy": "Toda a base foi lida localmente. Sugestões e respostas do chat não são aprendizado confirmado; versões anteriores substituídas não contam novamente.",
    }


def related_evidence(history, target, catalogs, documents):
    identity = resolve_customer(history, target, catalogs, documents)
    parties = [(str(p["id"]), normalized(p["name"])) for p in catalogs.get("parties", [])]
    # Nome isolado/genérico não sustenta associação inferida. Nunca gravar essa inferência.
    names = [
        (identifier, " " + name + " ")
        for identifier, name in parties
        if len(name.split()) >= 2 and len(name) >= 6
    ]

    def name_matches(description):
        value = " " + normalized(description) + " "
        return {identifier for identifier, name in names if name in value}

    candidates = set(document_candidates(target, documents))
    if target.get("party_id"):
        candidates.add(str(target["party_id"]))
    if not candidates:
        candidates = name_matches(target.get("raw_description"))
    if identity.get("party_id"):
        candidates = {identity["party_id"]}
    group = identity.get("customer_group_id")
    if group:
        candidates = set()
    result = {
        "party_candidates": sorted(candidates),
        "matching_records": 0,
        "fields": {},
        "match_basis": {},
        "customer_identity": identity,
    }
    description_facts, description_rows = description_evidence(
        history, target, identity, candidates
    )
    if len(description_rows) >= 3:
        return description_facts, description_rows
    if len(candidates) != 1 and not group:
        return description_facts, description_rows
    party = next(iter(candidates)) if candidates else None
    party_groups = {
        str(p["id"]): str(p.get("customer_group_id") or "") for p in catalogs.get("parties", [])
    }
    pix = "pix" in normalized(target.get("raw_description")).split()
    related, bases = [], Counter()
    for row in history:
        if target.get("id") and str(row.get("source_transaction_id")) == str(target["id"]):
            continue
        if target.get("account_id") and str(row["account_id"]) != str(target["account_id"]):
            continue
        if target.get("direction") and row["direction"] != target["direction"]:
            continue
        if row.get("movement_kind") != "NORMAL":
            continue
        if pix and "pix" not in normalized(row["raw_description"]).split():
            continue
        if group and (
            str(row.get("customer_group_id") or "") == group
            or party_groups.get(str(row.get("party_id"))) == group
        ):
            matches, basis = {group}, "confirmed_customer_group"
        elif group:
            continue
        elif row.get("party_id"):
            matches, basis = {str(row["party_id"])}, "confirmed_party_link"
        elif document_candidates(row, documents):
            matches, basis = set(document_candidates(row, documents)), "document"
        else:
            matches, basis = (
                name_matches(row["raw_description"]),
                "unique_name_in_bank_text",
            )
        if matches == {group or party}:
            related.append(row)
            bases[basis] += 1
    result.update(
        matching_records=len(related),
        match_basis=dict(bases),
        channel="PIX" if pix else "not_restricted",
        same_bank_account=bool(target.get("account_id")),
        direction=target.get("direction"),
    )
    for field in FIELDS:
        values = Counter(str(row.get(field) or "") for row in related)
        result["fields"][field] = {
            "observations": len(related),
            "missing": values.pop("", 0),
            "values": dict(values),
            "unanimous": len(values) == 1 and sum(values.values()) == len(related),
        }
    result["limitation"] = (
        "Correspondência por nome no texto é evidência contextual, não vínculo confirmado do cadastro. Conta bancária não determina centro de custos."
    )
    return result, related


def document_index(parties):
    result = {}
    for party in parties:
        document = re.sub(r"\D", "", str(party.get("tax_id") or ""))
        if document:
            result.setdefault(document, []).append(str(party["id"]))
    return result


def complete_suggestion(item, evidence, catalogs):
    result = prioritize_customer(item, evidence.get("customer_identity", {}), catalogs)
    if result.get("movement_kind") != "NORMAL" or evidence["matching_records"] < 1:
        return result
    if not result.get("customer_group_id") and len(evidence["party_candidates"]) == 1:
        candidate = evidence["party_candidates"][0]
        if not result.get("party_id"):
            result["party_id"] = candidate
    for field, table in (
        ("category_id", "categories"),
        ("subcategory_id", "subcategories"),
        ("cost_center_id", "cost_centers"),
    ):
        observation = evidence["fields"].get(field, {})
        if result.get(field):
            continue
        available = {str(row["id"]): row for row in catalogs.get(table, [])}
        ranked = sorted(
            (
                (identifier, count)
                for identifier, count in observation.get("values", {}).items()
                if identifier in available
                and (
                    field != "subcategory_id"
                    or str(available[identifier]["category_id"]) == str(result.get("category_id"))
                )
                and (
                    field != "category_id"
                    or available[identifier].get("kind")
                    == ("REVENUE" if evidence.get("direction") == "CREDIT" else "EXPENSE")
                )
            ),
            key=lambda pair: -pair[1],
        )
        # Predominância é sugestão, nunca confirmação. Empate não escolhe arbitrariamente.
        if ranked and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
            result[field] = ranked[0][0]
    return result


def field_confidences(values, evidence, fallback):
    result = {}
    total = evidence.get("matching_records", 0)
    for field in (*FIELDS, "movement_kind"):
        if not values.get(field):
            continue
        confidence = fallback
        counts = evidence.get("fields", {}).get(field, {}).get("values", {})
        if total >= 3 and field in FIELDS[:3]:
            count = counts.get(str(values[field]), 0)
            confidence = "HIGH" if count == total else "MEDIUM" if count > total / 2 else "LOW"
            if field == "cost_center_id" and not evidence.get("same_bank_account", True):
                confidence = "MEDIUM" if count > total / 2 else "LOW"
        elif field == "party_id" and evidence.get("match_basis", {}).get(
            "unique_name_in_bank_text"
        ):
            confidence = "MEDIUM"
        result[field] = confidence
    return result


def evidence_reason(evidence, catalogs):
    if not evidence["matching_records"]:
        return ""
    parts = [
        f"Histórico relacionado: {evidence['matching_records']} movimentos confirmados, mesma direção e mesmo canal quando PIX."
    ]
    if evidence.get("match_basis", {}).get("bank_description"):
        parts.append("Padrão da própria descrição bancária; não depende de cliente vinculado.")
    if not evidence.get("same_bank_account", True):
        parts.append(
            "Exemplos de outras contas da organização; revise especialmente o centro de custos."
        )
    if evidence.get("customer_identity", {}).get("customer_group_id"):
        group_id = evidence["customer_identity"]["customer_group_id"]
        group_name = next(
            (g["name"] for g in catalogs.get("customer_groups", []) if str(g["id"]) == group_id),
            "grupo cadastrado",
        )
        parts.append(
            f"Pagador relacionado ao grupo {group_name}; cliente/loja não distinguível. Não escolher filial arbitrariamente."
        )
    for field, table, label in (
        ("category_id", "categories", "Classificação"),
        ("subcategory_id", "subcategories", "Subclassificação"),
        ("cost_center_id", "cost_centers", "Centro de Custos"),
    ):
        names = {str(row["id"]): row["name"] for row in catalogs.get(table, [])}
        values = evidence["fields"][field]["values"]
        description = "; ".join(
            f"{names.get(identifier, 'cadastro indisponível')} ({count}/{evidence['matching_records']})"
            for identifier, count in sorted(values.items(), key=lambda pair: -pair[1])[:3]
        )
        if description:
            parts.append(f"{label}: {description}.")
    if evidence["match_basis"].get("unique_name_in_bank_text"):
        parts.append(
            "Parte do histórico foi relacionada pelo nome no texto bancário; esse vínculo é contextual e exige revisão."
        )
    return " ".join(parts)


def reviewed_confidence(confidence, values, evidence):
    if confidence != "HIGH" or values.get("movement_kind") != "NORMAL":
        return confidence
    required = ("category_id", "subcategory_id", "cost_center_id")
    if any(not values.get(field) for field in required):
        return "MEDIUM"
    if not evidence.get("same_bank_account", True):
        return "MEDIUM"
    if evidence.get("matching_records", 0) >= 3 and any(
        not evidence.get("fields", {}).get(field, {}).get("unanimous") for field in required
    ):
        return "MEDIUM"
    return confidence
