"""Exclusão auditada sem modificar movimentos bancários originais."""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE INDEX ix_statement_rows_transaction ON statement_rows(transaction_id, import_file_id)"
    )
    op.execute("""
        CREATE TABLE transaction_exclusions (
            transaction_id uuid PRIMARY KEY REFERENCES bank_transactions(id),
            organization_id uuid NOT NULL REFERENCES organizations(id),
            actor_id uuid NOT NULL REFERENCES users(id),
            batch_id uuid NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TRIGGER preserve_history BEFORE UPDATE OR DELETE ON transaction_exclusions
        FOR EACH ROW EXECUTE FUNCTION reject_historical_write()
    """)
    op.execute("""
        CREATE VIEW active_bank_transactions AS SELECT t.* FROM bank_transactions t
        WHERE NOT EXISTS (SELECT 1 FROM transaction_exclusions x WHERE x.transaction_id=t.id)
    """)


def downgrade():
    op.execute("DROP VIEW active_bank_transactions")
    op.drop_table("transaction_exclusions")
    op.drop_index("ix_statement_rows_transaction", table_name="statement_rows")
