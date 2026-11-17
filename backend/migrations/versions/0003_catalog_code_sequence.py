"""Cria a sequência para códigos automáticos de cadastro."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE catalog_code_number")


def downgrade() -> None:
    op.execute("DROP SEQUENCE catalog_code_number")
