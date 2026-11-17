"""Permite completar contas e classificações importadas após a carga."""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

BANK_FIELDS = ("bank_code", "branch", "account_number_masked", "holder_name")


def upgrade() -> None:
    op.add_column("bank_accounts", sa.Column("label", sa.Text()))
    for field in BANK_FIELDS:
        op.alter_column("bank_accounts", field, nullable=True)
    op.create_check_constraint(
        "ck_bank_accounts_complete_if_active",
        "bank_accounts",
        "NOT active OR (" + " AND ".join(f"{field} IS NOT NULL" for field in BANK_FIELDS) + ")",
    )
    op.alter_column("categories", "kind", nullable=True)
    op.create_check_constraint(
        "ck_categories_complete_if_active", "categories", "NOT active OR kind IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_constraint("ck_categories_complete_if_active", "categories", type_="check")
    op.alter_column("categories", "kind", nullable=False)
    op.drop_constraint("ck_bank_accounts_complete_if_active", "bank_accounts", type_="check")
    for field in BANK_FIELDS:
        op.alter_column("bank_accounts", field, nullable=False)
    op.drop_column("bank_accounts", "label")
