from uuid import UUID

from sqlalchemy import Connection, text

PREFIXES = {
    "bank_accounts": "CTA",
    "categories": "CLA",
    "cost_centers": "CC",
    "subcategories": "SUB",
}


def next_catalog_code(connection: Connection, table: str, scope_id: UUID) -> str:
    prefix = PREFIXES[table]
    scope = "category_id" if table == "subcategories" else "organization_id"
    while True:
        number = connection.scalar(text("SELECT nextval('catalog_code_number')"))
        code = f"{prefix}-{number:06d}"
        exists = connection.scalar(
            text(f"SELECT 1 FROM {table} WHERE {scope} = :scope AND code = :code"),
            {"scope": scope_id, "code": code},
        )
        if not exists:
            return code
