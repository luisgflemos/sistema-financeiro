"""Grupo pagador sem atribuir uma loja por falta de evidência."""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE customer_groups (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id),
            code text NOT NULL, name text NOT NULL CHECK(length(trim(name)) > 0),
            active boolean NOT NULL DEFAULT true,
            UNIQUE(organization_id,code), UNIQUE(id,organization_id)
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX uq_customer_group_name ON customer_groups(organization_id,lower(trim(name)))"
    )
    op.execute("ALTER TABLE parties ADD COLUMN customer_group_id uuid")
    op.execute(
        "ALTER TABLE parties ADD CONSTRAINT fk_party_group_org FOREIGN KEY(customer_group_id,organization_id) REFERENCES customer_groups(id,organization_id)"
    )
    op.execute("CREATE INDEX ix_party_customer_group ON parties(customer_group_id)")
    op.execute(
        "ALTER TABLE transaction_identifications ADD COLUMN customer_group_id uuid"
    )
    op.execute(
        "ALTER TABLE transaction_identifications ADD CONSTRAINT fk_identification_group_org FOREIGN KEY(customer_group_id,organization_id) REFERENCES customer_groups(id,organization_id)"
    )
    op.execute(
        "ALTER TABLE transaction_identifications ADD CONSTRAINT ck_specific_client_or_group CHECK(party_id IS NULL OR customer_group_id IS NULL)"
    )


def downgrade():
    op.execute("ALTER TABLE transaction_identifications DROP COLUMN customer_group_id")
    op.execute("ALTER TABLE parties DROP COLUMN customer_group_id")
    op.drop_table("customer_groups")
