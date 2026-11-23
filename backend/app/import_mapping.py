"""Sugestões locais de colunas, sem enviar dados do arquivo a serviços externos."""

import re
from unicodedata import normalize

ALIASES = {
    "parties": {
        "display_name": [
            "nome fantasia",
            "razao social",
            "nome cliente",
            "nome fornecedor",
            "razao erp",
        ],
        "contact_name": [
            "responsavel financeiro",
            "nome do contato",
            "responsavel",
            "pessoa contato",
        ],
        "contact_email": [
            "e mail financeiro",
            "email financeiro",
            "email contato",
            "correio eletronico",
        ],
        "contact_phone": [
            "tel comercial",
            "tel celular financeiro",
            "telefone comercial",
            "telefone celular",
            "whatsapp",
            "celular financeiro",
        ],
        "tax_id": ["cpf cnpj cliente", "cnpj cpf", "documento fiscal", "inscricao federal"],
        "type": ["categoria erp", "tipo cliente fornecedor", "tipo pessoa cadastro"],
    },
    "bank-accounts": {
        "label": ["apelido conta", "nome banco conta"],
        "bank_code": ["numero banco", "cod banco"],
        "branch": ["numero agencia", "agencia conta"],
        "account_number": ["numero cc", "numero conta corrente"],
        "holder_document": ["documento titular", "cpf cnpj titular"],
    },
    "categories": {
        "name": ["grupo financeiro", "grupo erp"],
        "kind": ["natureza financeira", "natureza erp"],
        "sub_name": ["subgrupo", "detalhe erp"],
    },
    "cost-centers": {
        "name": ["departamento", "nome centro", "centro custo"],
        "parent": ["centro custo superior"],
    },
}


def normalized(value):
    plain = normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", plain).strip()


def content_matches(field, values):
    if not values:
        return False
    patterns = {
        "contact_email": r"[^\s@]+@[^\s@]+\.[^\s@]+",
        "tax_id": r"\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{14}",
        "holder_document": r"\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{14}",
        "contact_phone": r"(?:\+\d{1,3}\s*)?\(\d{2}\)\s*\d{4,5}[- ]?\d{4}",
    }
    pattern = patterns.get(field)
    return (
        bool(pattern)
        and sum(bool(re.fullmatch(pattern, value)) for value in values) / len(values) >= 0.8
    )


def suggest_mapping(kind, fields, headers, rows):
    known_names = {
        normalized(value)
        for field, label, _, aliases in fields
        for value in [field, label, *aliases, *ALIASES.get(kind, {}).get(field, [])]
    }
    candidates = {}
    for field, label, _, aliases in fields:
        exact = {normalized(value) for value in [field, label, *aliases]}
        synonyms = {normalized(value) for value in ALIASES.get(kind, {}).get(field, [])}
        if field == "active":
            synonyms.update({"cliente ativo", "registro ativo", "habilitado"})
        matches = []
        for column, header in enumerate(headers):
            name = normalized(header)
            score = 0
            reason = ""
            if name in exact:
                score, reason = 100, "O cabeçalho corresponde ao nome deste campo."
            elif name in synonyms:
                score, reason = 90, "O cabeçalho é um nome equivalente usado em cadastros."
            elif any(
                len(alias) >= 5 and (" " + alias + " ") in (" " + name + " ")
                for alias in exact | synonyms
            ):
                score, reason = 80, "O cabeçalho contém um termo relacionado a este campo."
            values = [
                str(row[column]).strip()
                for row in rows
                if column < len(row) and str(row[column]).strip()
            ]
            if not score and name not in known_names and content_matches(field, values):
                score, reason = 65, "O formato dos valores da amostra é compatível com este campo."
            if score:
                matches.append(
                    {
                        "column": column,
                        "reason": reason,
                        "confidence": "Alta" if score >= 90 else "Média",
                        "score": score,
                    }
                )
        candidates[field] = sorted(matches, key=lambda item: (-item["score"], item["column"]))

    proposed = {}
    for field, matches in candidates.items():
        if matches and (len(matches) == 1 or matches[0]["score"] - matches[1]["score"] >= 15):
            proposed[field] = matches[0]["column"]

    mapping, suggestions, ambiguities = {}, {}, {}
    for field, matches in candidates.items():
        if not matches:
            continue
        column = proposed.get(field)
        if column is not None and list(proposed.values()).count(column) == 1:
            mapping[field] = column
            suggestions[field] = {key: value for key, value in matches[0].items() if key != "score"}
        else:
            ambiguities[field] = [
                {key: value for key, value in item.items() if key != "score"}
                for item in matches[:4]
            ]
    return mapping, suggestions, ambiguities
