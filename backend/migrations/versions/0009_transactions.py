"""Preserva arquivos originais e identificações gerenciais versionadas."""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE statement_contents (
            import_file_id uuid PRIMARY KEY REFERENCES import_files(id),
            original_bytes bytea NOT NULL
        )
    """)
    op.execute("""
        CREATE TABLE statement_rows (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            import_file_id uuid NOT NULL REFERENCES import_files(id),
            source_row integer NOT NULL CHECK (source_row > 0),
            transaction_id uuid REFERENCES bank_transactions(id),
            decision text NOT NULL CHECK (decision IN ('new', 'duplicate', 'skip')),
            original_data jsonb NOT NULL,
            UNIQUE(import_file_id, source_row)
        )
    """)
    op.execute("""
        CREATE TABLE transaction_identifications (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
            organization_id uuid NOT NULL REFERENCES organizations(id),
            version integer NOT NULL CHECK (version > 0),
            party_id uuid REFERENCES parties(id),
            category_id uuid REFERENCES categories(id),
            subcategory_id uuid REFERENCES subcategories(id),
            cost_center_id uuid REFERENCES cost_centers(id),
            movement_kind text NOT NULL CHECK (
                movement_kind IN ('NORMAL', 'AUTOMATIC_PROCESS', 'INTERNAL_TRANSFER')
            ),
            notes text,
            method text NOT NULL CHECK (method IN ('OPERATOR', 'AI_CONFIRMED', 'PATTERN')),
            actor_id uuid NOT NULL REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(transaction_id, version)
        )
    """)
    op.execute("""
        CREATE TABLE transaction_suggestions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
            organization_id uuid NOT NULL REFERENCES organizations(id),
            payload jsonb NOT NULL,
            reason text NOT NULL,
            confidence text NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
            model text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE INDEX ix_transaction_identifications_latest
        ON transaction_identifications(transaction_id, version DESC)
    """)
    op.execute("""
        CREATE INDEX ix_transaction_suggestions_latest
        ON transaction_suggestions(transaction_id, created_at DESC)
    """)
    for table in (
        "statement_contents",
        "statement_rows",
        "transaction_identifications",
        "transaction_suggestions",
    ):
        op.execute(f"""
            CREATE TRIGGER preserve_history BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION reject_historical_write()
        """)


def downgrade():
    op.drop_table("transaction_suggestions")
    op.drop_table("transaction_identifications")
    op.drop_table("statement_rows")
    op.drop_table("statement_contents")
