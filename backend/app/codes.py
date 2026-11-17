from uuid import UUID

from sqlalchemy import Connection, text

PREFIXES = {
    "bank_accounts": "CTA",
    "categories": "CLA",
    "cost_centers": "CC",
}


def next_catalog_code(connection: Connection, table: str, organization_id: UUID) -> str:
    prefix = PREFIXES[table]
    while True:
        number = connection.scalar(text("SELECT nextval('catalog_code_number')"))
        code = f"{prefix}-{number:06d}"
        exists = connection.scalar(
            text(f"SELECT 1 FROM {table} WHERE organization_id = :org AND code = :code"),
            {"org": organization_id, "code": code},
        )
        if not exists:
            return code
