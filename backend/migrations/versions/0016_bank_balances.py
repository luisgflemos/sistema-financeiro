"""Referências manuais e ajustes de saldo independentes do extrato."""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE bank_balance_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id),
        account_id uuid NOT NULL REFERENCES bank_accounts(id),
        kind text NOT NULL CHECK(kind IN ('OPENING','ADJUSTMENT')),
        posted_on date NOT NULL,
        amount numeric(18,2) NOT NULL,
        reason text NOT NULL CHECK(length(trim(reason)) >= 3),
        actor_id uuid NOT NULL REFERENCES users(id),
        request_key uuid NOT NULL, payload_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(organization_id,request_key),
        CHECK(kind='OPENING' OR amount<>0)
    )""")
    op.execute("""CREATE TABLE bank_balance_reversals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL UNIQUE REFERENCES bank_balance_events(id),
        reason text NOT NULL CHECK(length(trim(reason)) >= 3),
        actor_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("CREATE INDEX balance_events_account ON bank_balance_events(account_id,posted_on)")
    for table in ("bank_balance_events", "bank_balance_reversals"):
        op.execute(
            f"CREATE TRIGGER preserve_history BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION reject_historical_write()"
        )


def downgrade():
    op.drop_table("bank_balance_reversals")
    op.drop_table("bank_balance_events")
