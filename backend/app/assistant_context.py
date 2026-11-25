"""Contexto legível: nomes e relações explícitos, sem exigir tradução de UUID pelo modelo."""

import re
import unicodedata
from uuid import UUID

UUID_PATTERN = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I
)
FIELD_NAMES = {
    "category_id": "classificação",
    "subcategory_id": "subclassificação",
    "cost_center_id": "centro_de_custos",
    "party_id": "cliente_fornecedor",
    "customer_group_id": "grupo_de_clientes",
}


def catalog_names(context):
    return {
        str(row["id"]): row["name"]
        for rows in context.get("catalogs", {}).values()
        for row in rows
        if row.get("id") and row.get("name")
    }


def readable_text(value, names):
    return UUID_PATTERN.sub(
        lambda match: names.get(match.group().lower(), "[cadastro não disponível]"),
        str(value),
    )


def readable_context(context):
    names = catalog_names(context)

    def visit(value):
        if isinstance(value, dict):
            if value and all(
                UUID_PATTERN.fullmatch(str(k)) or k == "MISSING" for k in value
            ):
                return [
                    {
                        "nome": names.get(
                            str(k),
                            "Não informado"
                            if k == "MISSING"
                            else "Cadastro não disponível",
                        ),
                        "quantidade": visit(v),
                    }
                    for k, v in value.items()
                ]
            return {
                FIELD_NAMES.get(key, key): visit(item)
                for key, item in value.items()
                if key != "id"
            }
        if isinstance(value, (list, tuple)):
            return [visit(item) for item in value]
        if isinstance(value, (str, UUID)):
            return readable_text(value, names)
        return value

    return visit(context)


def suggestion_diagnostic(context):
    record = context.get("transaction") or {}
    suggestion = record.get("suggestion") or {}
    evidence = context.get("related_history", {}).get("same_account", {})
    field = evidence.get("fields", {}).get("subcategory_id", {})
    count = evidence.get("matching_records", 0)
    names = catalog_names(context)
    missing = bool(suggestion) and not suggestion.get("subcategory_id")
    result = {"stored_suggestion_missing_subclassification": missing}
    party_field = evidence.get("fields", {}).get("party_id", {})
    missing_party = party_field.get("missing", count)
    if count:
        result["historical_client_link"] = {
            "records": count,
            "without_registered_client_link": missing_party,
            "with_registered_client_link": count - missing_party,
            "interpretation": (
                f"Dos {count} registros relacionados, {missing_party} não têm cliente/fornecedor vinculado no cadastro. "
                "O nome no texto bancário permite relacionar histórico, mas não cria vínculo cadastral. "
                "Não afirmar que o vínculo de cliente é unânime se houver registros sem vínculo."
            ),
        }
    if count >= 3 and field.get("unanimous"):
        identifier, occurrences = next(iter(field["values"].items()))
        result.update(
            observed_subclassification=names.get(identifier, "Cadastro não disponível"),
            matching_records=count,
            occurrences=occurrences,
            interpretation="Existe padrão unânime de subclassificação no histórico relacionado. Não alegar ausência de padrão ou inventar causas técnicas.",
        )
        if missing:
            result["stored_suggestion_assessment"] = (
                "A sugestão armazenada está incompleta apesar desse padrão. Isso é uma omissão da sugestão, não evidência de falta de padrão. Orientar Reavaliar sugestão, conferir os campos e salvar. O chat não fez a alteração."
            )
    if (
        suggestion.get("confidence") == "HIGH"
        and suggestion.get("movement_kind") == "NORMAL"
        and any(
            not suggestion.get(key)
            for key in ("category_id", "subcategory_id", "cost_center_id")
        )
    ):
        result["confidence_assessment"] = (
            "A confiança alta armazenada não justifica a ausência de campos obrigatórios; a sugestão precisa de revisão."
        )
    return result


def historical_pattern_answer(question, context):
    """Fatos quantitativos saem da consulta, sem delegar nomes ou contagens à redação livre."""
    question = "".join(
        c
        for c in unicodedata.normalize("NFD", question.lower())
        if not unicodedata.combining(c)
    )
    if not any(
        word in question
        for word in (
            "padrao",
            "preval",
            "subclassifica",
            "centro de custo",
            "vinculo",
            "vinculado",
        )
    ):
        return None
    if any(
        word in question
        for word in (
            "como cadastrar",
            "o que e um padrao",
            "como funciona",
            "como aprende",
            "como alterar",
            "quero alterar",
            "quero mudar",
            "exclua",
            "cadastre",
            "salve",
        )
    ):
        return None
    history = context.get("related_history", {})
    scoped = history.get("same_account", {})
    all_accounts = history.get("all_accounts", {})
    if not scoped.get("matching_records") and not all_accounts.get("matching_records"):
        return "Não encontrei histórico confirmado que possa ser relacionado com segurança a este cliente ou movimento. Isso não prova ausência de padrão na empresa; falta uma associação segura para esta consulta. Confira o cliente e os dados do movimento."
    names = catalog_names(context)
    parts = []
    active = {
        str(row["id"]): row.get("active", True)
        for rows in context.get("catalogs", {}).values()
        for row in rows
    }
    candidates = scoped.get("party_candidates", [])
    identifier = (
        candidates[0]
        if len(candidates) == 1
        else (context.get("transaction") or {}).get("suggestion", {}).get("party_id")
    )
    if not identifier:
        identifier = scoped.get("customer_identity", {}).get("customer_group_id")
        if identifier:
            parts.append(
                "O pagador identifica o grupo, mas não distingue o cliente/loja. Não atribuir uma filial arbitrariamente."
            )
    if identifier and str(identifier) in names:
        parts.append(f"Histórico relacionado a {names[str(identifier)]}.")
    scopes = [
        (
            "Nesta conta" if scoped.get("same_bank_account") else "Em todas as contas",
            scoped,
        )
    ]
    if scoped.get("same_bank_account") and all_accounts.get("matching_records"):
        scopes.append(("Em todas as contas", all_accounts))
    for title, facts in scopes:
        count = facts.get("matching_records", 0)
        if not count:
            continue
        parts.append(f"{title}: {count} movimentos confirmados relacionados.")
        fields = facts.get("fields", {})
        party = fields.get("party_id")
        if party is not None:
            missing = party.get("missing", 0)
            linked = count - missing
            parts.append(
                f"Cliente/fornecedor vinculado no cadastro: {linked}/{count}; sem vínculo cadastral: {missing}/{count}."
            )
        if facts.get("match_basis", {}).get("unique_name_in_bank_text"):
            parts.append(
                "Parte do histórico foi relacionada pelo nome no texto bancário; isso não cria um vínculo cadastral."
            )
        for field, label in (
            ("category_id", "Classificação"),
            ("subcategory_id", "Subclassificação"),
            ("cost_center_id", "Centro de Custos"),
        ):
            evidence = fields.get(field)
            if evidence is None:
                continue
            ranked = sorted(
                evidence.get("values", {}).items(), key=lambda pair: -pair[1]
            )
            values = "; ".join(
                f"{names.get(identifier, 'Cadastro não disponível')} ({number}/{count})"
                for identifier, number in ranked[:3]
            )
            if len(ranked) > 3:
                values += f"; outros {len(ranked) - 3} cadastros"
            if evidence.get("missing"):
                values += f"; não informado ({evidence['missing']}/{count})"
            parts.append(f"{label}: {values.lstrip('; ') or 'não informado'}.")
            if ranked and count >= 3:
                if not active.get(ranked[0][0], False):
                    parts.append(
                        "O cadastro predominante está inativo ou indisponível; não é elegível para uma nova identificação."
                    )
                    continue
                if evidence.get("unanimous"):
                    parts.append("Padrão unânime neste conjunto.")
                elif ranked[0][1] >= 2 and (
                    len(ranked) == 1 or ranked[0][1] > ranked[1][1]
                ):
                    parts.append(
                        f"Predomina {names.get(ranked[0][0], 'cadastro não disponível')}; pode ser sugerido em amarelo para revisão."
                    )
                else:
                    parts.append("Sem predominância única suficiente; requer revisão.")
        parts.append("")
    diagnostic = context.get("recognition_review", {})
    if diagnostic.get("stored_suggestion_missing_subclassification") and diagnostic.get(
        "observed_subclassification"
    ):
        parts.append(
            "A sugestão armazenada omitiu a subclassificação apesar do padrão histórico. Use Reavaliar sugestão, confira os campos e salve quando estiver de acordo."
        )
    parts.append(
        "A conta bancária não determina o centro de custos. Esta consulta não alterou a identificação."
    )
    return "\n".join(parts).strip()[:3000]
