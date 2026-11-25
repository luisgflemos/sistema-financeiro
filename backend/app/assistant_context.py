"""Contexto legível: nomes e relações explícitos, sem exigir tradução de UUID pelo modelo."""

import re
from uuid import UUID

UUID_PATTERN = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
FIELD_NAMES = {
    "category_id": "classificação",
    "subcategory_id": "subclassificação",
    "cost_center_id": "centro_de_custos",
    "party_id": "cliente_fornecedor",
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
        lambda match: names.get(match.group().lower(), "[cadastro não disponível]"), str(value)
    )


def readable_context(context):
    names = catalog_names(context)

    def visit(value):
        if isinstance(value, dict):
            if value and all(UUID_PATTERN.fullmatch(str(k)) or k == "MISSING" for k in value):
                return [
                    {
                        "nome": names.get(
                            str(k), "Não informado" if k == "MISSING" else "Cadastro não disponível"
                        ),
                        "quantidade": visit(v),
                    }
                    for k, v in value.items()
                ]
            return {
                FIELD_NAMES.get(key, key): visit(item) for key, item in value.items() if key != "id"
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
            not suggestion.get(key) for key in ("category_id", "subcategory_id", "cost_center_id")
        )
    ):
        result["confidence_assessment"] = (
            "A confiança alta armazenada não justifica a ausência de campos obrigatórios; a sugestão precisa de revisão."
        )
    return result
