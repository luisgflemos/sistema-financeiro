"""Tentativas de reimportação preservam arquivo e movimentos anteriores."""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE import_files ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK (generation > 0)"
    )
    op.drop_constraint("import_files_bank_account_id_sha256_key", "import_files", type_="unique")
    op.create_unique_constraint(
        "uq_import_file_generation", "import_files", ["bank_account_id", "sha256", "generation"]
    )


def downgrade():
    # Bancos com reimportações efetivas exigem preservar/exportar os dados antes do downgrade.
    op.drop_constraint("uq_import_file_generation", "import_files", type_="unique")
    op.create_unique_constraint(
        "import_files_bank_account_id_sha256_key", "import_files", ["bank_account_id", "sha256"]
    )
    op.drop_column("import_files", "generation")
