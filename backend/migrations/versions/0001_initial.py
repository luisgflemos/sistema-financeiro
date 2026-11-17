"""Cria os cadastros, a origem bancária e a trilha de auditoria."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE organizations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email text NOT NULL UNIQUE,
            display_name text NOT NULL,
            active boolean NOT NULL DEFAULT true
        )
        """
    )
    op.execute(
        """
        CREATE TABLE bank_accounts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations (id),
            code text NOT NULL,
            bank_code text NOT NULL,
            branch text NOT NULL,
            account_number_masked text NOT NULL,
            holder_name text NOT NULL,
            currency text NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
            active boolean NOT NULL DEFAULT true,
            UNIQUE (organization_id, code),
            UNIQUE (id, organization_id),
            UNIQUE (id, currency)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE cost_centers (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations (id),
            code text NOT NULL,
            name text NOT NULL,
            parent_id uuid,
            active boolean NOT NULL DEFAULT true,
            UNIQUE (organization_id, code),
            UNIQUE (id, organization_id),
            FOREIGN KEY (parent_id, organization_id) REFERENCES cost_centers (id, organization_id),
            CHECK (parent_id <> id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE parties (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations (id),
            type text NOT NULL CHECK (type IN ('CUSTOMER', 'SUPPLIER', 'BOTH')),
            display_name text NOT NULL,
            tax_id text,
            active boolean NOT NULL DEFAULT true
        )
        """
    )
    op.execute(
        """
        CREATE TABLE categories (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations (id),
            code text NOT NULL,
            name text NOT NULL,
            kind text NOT NULL CHECK (kind IN ('REVENUE', 'EXPENSE', 'NEUTRAL')),
            active boolean NOT NULL DEFAULT true,
            UNIQUE (organization_id, code)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE subcategories (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            category_id uuid NOT NULL REFERENCES categories (id),
            code text NOT NULL,
            name text NOT NULL,
            active boolean NOT NULL DEFAULT true,
            UNIQUE (category_id, code)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE import_batches (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations (id),
            imported_by uuid NOT NULL REFERENCES users (id),
            created_at timestamptz NOT NULL DEFAULT now(),
            status text NOT NULL,
            UNIQUE (id, organization_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE import_files (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL,
            batch_id uuid NOT NULL,
            bank_account_id uuid NOT NULL,
            file_name text NOT NULL,
            sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
            format text NOT NULL,
            storage_key text NOT NULL,
            period_start date,
            period_end date,
            parser_version text NOT NULL,
            FOREIGN KEY (batch_id, organization_id) REFERENCES import_batches (id, organization_id),
            FOREIGN KEY (bank_account_id, organization_id)
                REFERENCES bank_accounts (id, organization_id),
            UNIQUE (bank_account_id, sha256),
            UNIQUE (id, bank_account_id),
            CHECK (period_end >= period_start)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE bank_transactions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id uuid NOT NULL,
            import_file_id uuid NOT NULL,
            source_row integer NOT NULL CHECK (source_row > 0),
            bank_external_id text CHECK (btrim(bank_external_id) <> ''),
            posted_on date NOT NULL,
            transaction_on date,
            direction text NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
            amount numeric NOT NULL CHECK (
                amount > 0 AND amount < 10000000000000000 AND scale(amount) <= 2
            ),
            currency text NOT NULL,
            raw_description text NOT NULL,
            raw_counterparty text,
            raw_payload jsonb NOT NULL,
            normalized_counterparty text,
            fingerprint text NOT NULL,
            FOREIGN KEY (account_id, currency) REFERENCES bank_accounts (id, currency),
            FOREIGN KEY (import_file_id, account_id) REFERENCES import_files (id, bank_account_id),
            UNIQUE (import_file_id, source_row)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE audit_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations (id),
            actor_id uuid REFERENCES users (id),
            entity_type text NOT NULL,
            entity_id uuid NOT NULL,
            action text NOT NULL,
            old_json jsonb,
            new_json jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_bank_transactions_external_id
            ON bank_transactions (account_id, bank_external_id)
            WHERE bank_external_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX ix_bank_transactions_fingerprint
            ON bank_transactions (account_id, fingerprint)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_audit_events_entity
            ON audit_events (organization_id, entity_type, entity_id, created_at)
        """
    )
    op.execute(
        """
        CREATE FUNCTION reject_historical_write() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'A tabela % preserva o histórico', TG_TABLE_NAME
                USING ERRCODE = '55000';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER preserve_history
            BEFORE UPDATE OR DELETE ON import_files
            FOR EACH ROW EXECUTE FUNCTION reject_historical_write()
        """
    )
    op.execute(
        """
        CREATE TRIGGER preserve_history
            BEFORE UPDATE OR DELETE ON bank_transactions
            FOR EACH ROW EXECUTE FUNCTION reject_historical_write()
        """
    )
    op.execute(
        """
        CREATE TRIGGER preserve_history
            BEFORE UPDATE OR DELETE ON audit_events
            FOR EACH ROW EXECUTE FUNCTION reject_historical_write()
        """
    )


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("bank_transactions")
    op.drop_table("import_files")
    op.drop_table("import_batches")
    op.drop_table("subcategories")
    op.drop_table("categories")
    op.drop_table("parties")
    op.drop_table("cost_centers")
    op.drop_table("bank_accounts")
    op.drop_table("users")
    op.drop_table("organizations")
    op.execute("DROP FUNCTION reject_historical_write()")
