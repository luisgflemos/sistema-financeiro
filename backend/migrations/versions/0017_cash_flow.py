"""Decisões manuais sobre estimativas, sem alterar movimentos ou compromissos."""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE cash_projection_decisions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id),
            pattern_key text NOT NULL CHECK(length(pattern_key)=64),
            period date NOT NULL CHECK(EXTRACT(DAY FROM period)=1),
            action text NOT NULL CHECK(action IN ('ADJUST','EXCLUDE','RESET')),
            amount numeric(18,2) CHECK(amount >= 0),
            reason text NOT NULL CHECK(length(trim(reason))>=3),
            request_key uuid NOT NULL,
            payload_hash text NOT NULL,
            actor_id uuid NOT NULL REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            UNIQUE(organization_id,request_key),
            CHECK(action <> 'ADJUST' OR amount IS NOT NULL)
        );
        CREATE INDEX cash_decisions_latest ON cash_projection_decisions(organization_id,pattern_key,period,created_at DESC);
        CREATE TRIGGER preserve_cash_decisions BEFORE UPDATE OR DELETE ON cash_projection_decisions
        FOR EACH ROW EXECUTE FUNCTION reject_historical_write();
    """)


def downgrade():
    op.execute("DROP TABLE cash_projection_decisions")
