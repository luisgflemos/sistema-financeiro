"""Separar ajustes comerciais do dinheiro efetivo e preservar a identificação da baixa."""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE planned_entries ALTER COLUMN cost_center_id DROP NOT NULL")
    op.execute("""ALTER TABLE entry_settlements
        ADD COLUMN discount numeric(18,2) NOT NULL DEFAULT 0 CHECK(discount >= 0),
        ADD COLUMN surcharge numeric(18,2) NOT NULL DEFAULT 0 CHECK(surcharge >= 0),
        ADD COLUMN review_json jsonb,
        ADD COLUMN payload_hash text,
        ADD CONSTRAINT settlement_one_adjustment CHECK(discount = 0 OR surcharge = 0)
    """)


def downgrade():
    # Não inventar um centro de custos em previsões reais para permitir downgrade.
    op.execute("ALTER TABLE planned_entries ALTER COLUMN cost_center_id SET NOT NULL")
    op.execute("""ALTER TABLE entry_settlements
        DROP CONSTRAINT settlement_one_adjustment,
        DROP COLUMN payload_hash, DROP COLUMN review_json,
        DROP COLUMN surcharge, DROP COLUMN discount
    """)
