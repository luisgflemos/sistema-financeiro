"""Acrescenta vigência das classificações e contatos das contrapartes mestres."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("categories", "subcategories"):
        op.add_column(table, sa.Column("valid_from", sa.Date()))
        op.add_column(table, sa.Column("valid_to", sa.Date()))
        op.create_check_constraint(f"ck_{table}_valid_period", table, "valid_to >= valid_from")
    op.add_column("parties", sa.Column("contact_email", sa.Text()))
    op.add_column("parties", sa.Column("contact_phone", sa.Text()))


def downgrade() -> None:
    op.drop_column("parties", "contact_phone")
    op.drop_column("parties", "contact_email")
    for table in ("subcategories", "categories"):
        op.drop_constraint(f"ck_{table}_valid_period", table, type_="check")
        op.drop_column(table, "valid_to")
        op.drop_column(table, "valid_from")
