"""Acrescenta razão social e nome fantasia aos clientes e fornecedores."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("parties", sa.Column("legal_name", sa.Text()))
    op.add_column("parties", sa.Column("trade_name", sa.Text()))


def downgrade() -> None:
    op.drop_column("parties", "trade_name")
    op.drop_column("parties", "legal_name")
