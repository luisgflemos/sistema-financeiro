"""Análise local de toda a base, com evidência separada por campo e sem gravações."""

import re
import unicodedata
from collections import Counter
from decimal import Decimal

from sqlalchemy import text

from app.transactions import LATEST

FIELDS = ("category_id", "subcategory_id", "cost_center_id", "party_id")


def normalized(value):
    value = "".join(
        c
        for c in unicodedata.normalize("NFD", str(value or "").lower())
        if not unicodedata.combining(c)
    )
    return " ".join(re.findall(r"[a-z0-9]+", value))


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
                {"records": 0, "bank_amount": Decimal(0), "identified_normal_amount": Decimal(0)},
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
    result = {
        "party_candidates": sorted(candidates),
        "matching_records": 0,
        "fields": {},
        "match_basis": {},
    }
    if len(candidates) != 1:
        result["limitation"] = (
            "Cliente não identificado ou ambíguo; não atribuir histórico de outra pessoa."
        )
        return result, []
    party = next(iter(candidates))
    pix = "pix" in normalized(target.get("raw_description")).split()
    related, bases = [], Counter()
    for row in history:
        if str(row.get("source_transaction_id")) == str(target.get("id")):
            continue
        if target.get("account_id") and str(row["account_id"]) != str(target["account_id"]):
            continue
        if target.get("direction") and row["direction"] != target["direction"]:
            continue
        if row.get("movement_kind") != "NORMAL":
            continue
        if pix and "pix" not in normalized(row["raw_description"]).split():
            continue
        if row.get("party_id"):
            matches, basis = {str(row["party_id"])}, "confirmed_party_link"
        elif document_candidates(row, documents):
            matches, basis = set(document_candidates(row, documents)), "document"
        else:
            matches, basis = name_matches(row["raw_description"]), "unique_name_in_bank_text"
        if matches == {party}:
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
    result = dict(item)
    if (
        result.get("movement_kind") != "NORMAL"
        or evidence["matching_records"] < 3
        or evidence["party_candidates"] != [str(result.get("party_id") or "")]
    ):
        return result
    for field, table in (
        ("category_id", "categories"),
        ("subcategory_id", "subcategories"),
        ("cost_center_id", "cost_centers"),
    ):
        observation = evidence["fields"].get(field, {})
        if result.get(field) or not observation.get("unanimous"):
            continue
        identifier = next(iter(observation["values"]))
        option = next(
            (row for row in catalogs.get(table, []) if str(row["id"]) == identifier), None
        )
        if option and (
            field != "subcategory_id"
            or str(option["category_id"]) == str(result.get("category_id"))
        ):
            result[field] = identifier
    return result


def evidence_reason(evidence, catalogs):
    if not evidence["matching_records"]:
        return ""
    parts = [
        f"Histórico relacionado: {evidence['matching_records']} movimentos confirmados, mesma direção e mesmo canal quando PIX."
    ]
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
    if evidence.get("matching_records", 0) >= 3 and any(
        not evidence.get("fields", {}).get(field, {}).get("unanimous") for field in required
    ):
        return "MEDIUM"
    return confidence
