"""Permite ativar contas sem nome do titular."""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_bank_accounts_complete_if_active", "bank_accounts", type_="check")
    op.create_check_constraint(
        "ck_bank_accounts_complete_if_active",
        "bank_accounts",
        "NOT active OR (bank_code IS NOT NULL AND branch IS NOT NULL "
        "AND account_number_masked IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_bank_accounts_complete_if_active", "bank_accounts", type_="check")
    op.create_check_constraint(
        "ck_bank_accounts_complete_if_active",
        "bank_accounts",
        "NOT active OR (bank_code IS NOT NULL AND branch IS NOT NULL "
        "AND account_number_masked IS NOT NULL AND holder_name IS NOT NULL)",
    )
