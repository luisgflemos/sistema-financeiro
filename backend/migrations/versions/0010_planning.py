"""Compromissos previstos separados dos movimentos bancários realizados."""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE planned_series (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id),
            request_key uuid NOT NULL, payload_hash text NOT NULL,
            actor_id uuid NOT NULL REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(organization_id, request_key)
        )
    """)
    op.execute("""
        CREATE TABLE planned_entries (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id),
            series_id uuid NOT NULL REFERENCES planned_series(id),
            occurrence integer NOT NULL CHECK(occurrence > 0),
            occurrences integer NOT NULL CHECK(occurrences >= occurrence),
            frequency text NOT NULL CHECK(frequency IN ('ONCE','WEEKLY','MONTHLY','YEARLY')),
            description text NOT NULL CHECK(length(trim(description)) > 0),
            due_on date NOT NULL, direction text NOT NULL CHECK(direction IN ('CREDIT','DEBIT')),
            expected_amount numeric(18,2) NOT NULL CHECK(expected_amount > 0),
            currency char(3) NOT NULL DEFAULT 'BRL',
            account_id uuid REFERENCES bank_accounts(id),
            category_id uuid NOT NULL REFERENCES categories(id),
            subcategory_id uuid NOT NULL REFERENCES subcategories(id),
            cost_center_id uuid NOT NULL REFERENCES cost_centers(id),
            party_id uuid REFERENCES parties(id), notes text,
            cancelled boolean NOT NULL DEFAULT false,
            version integer NOT NULL DEFAULT 1 CHECK(version > 0),
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(series_id, occurrence)
        )
    """)
    op.execute("""
        CREATE TABLE entry_settlements (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            entry_id uuid NOT NULL REFERENCES planned_entries(id),
            transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
            amount numeric(18,2) NOT NULL CHECK(amount > 0),
            finish boolean NOT NULL DEFAULT false,
            actor_id uuid NOT NULL REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE settlement_reversals (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            settlement_id uuid NOT NULL UNIQUE REFERENCES entry_settlements(id),
            actor_id uuid NOT NULL REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX planning_due ON planned_entries(organization_id, due_on)")
    op.execute("CREATE INDEX settlements_transaction ON entry_settlements(transaction_id)")
    for table in ("planned_series", "entry_settlements", "settlement_reversals"):
        op.execute(
            f"CREATE TRIGGER preserve_history BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION reject_historical_write()"
        )


def downgrade():
    for table in ("settlement_reversals", "entry_settlements", "planned_entries", "planned_series"):
        op.execute(f"DROP TABLE {table}")
