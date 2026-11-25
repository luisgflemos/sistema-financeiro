"""Exclusão lógica de previsões sem apagar a série ou auditoria."""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE planned_entries ADD COLUMN deleted_at timestamptz")
    op.execute("CREATE INDEX settlements_entry ON entry_settlements(entry_id)")


def downgrade():
    op.execute("DROP INDEX settlements_entry")
    op.execute("ALTER TABLE planned_entries DROP COLUMN deleted_at")
