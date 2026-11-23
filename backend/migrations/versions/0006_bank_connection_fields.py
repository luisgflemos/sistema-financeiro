"""Acrescenta identificação da conta para futura conexão bancária."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for field in ("holder_document", "account_number", "account_digit", "account_type"):
        op.add_column("bank_accounts", sa.Column(field, sa.Text()))


def downgrade() -> None:
    for field in ("account_type", "account_digit", "account_number", "holder_document"):
        op.drop_column("bank_accounts", field)
