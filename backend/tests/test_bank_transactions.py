from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.db import create_database_engine


@pytest.fixture
def connection():
    engine = create_database_engine()
    try:
        with engine.connect() as connection, connection.begin() as transaction:
            yield connection
            transaction.rollback()
    finally:
        engine.dispose()


def insert(connection, statement, **parameters):
    return connection.execute(text(statement), parameters).scalar_one()


def test_preserves_identical_rows_and_rejects_duplicate_bank_id(connection):
    organization = insert(
        connection, "INSERT INTO organizations (name) VALUES ('Sintética') RETURNING id"
    )
    actor = insert(
        connection,
        """
        INSERT INTO users (email, display_name)
        VALUES ('teste@example.test', 'Operador sintético') RETURNING id
        """,
    )
    account = insert(
        connection,
        """
        INSERT INTO bank_accounts (
            organization_id, code, bank_code, branch, account_number_masked, holder_name
        )
        VALUES (:org, 'teste', '000', '0000', '**00', 'Titular sintético') RETURNING id
        """,
        org=organization,
    )
    batch = insert(
        connection,
        """
        INSERT INTO import_batches (organization_id, imported_by, status)
        VALUES (:org, :actor, 'TEST') RETURNING id
        """,
        org=organization,
        actor=actor,
    )
    file = insert(
        connection,
        """
        INSERT INTO import_files (
            organization_id, batch_id, bank_account_id, file_name,
            sha256, format, storage_key, parser_version
        )
        VALUES (:org, :batch, :account, 'sintetico.csv',
                repeat('a', 64), 'CSV', 'sintetico', 'teste') RETURNING id
        """,
        org=organization,
        batch=batch,
        account=account,
    )

    statement = """
        INSERT INTO bank_transactions (
            account_id, import_file_id, source_row, bank_external_id, posted_on,
            direction, amount, currency, raw_description, raw_payload, fingerprint
        )
        VALUES (:account, :file, :row, :external_id, DATE '2026-01-01', 'DEBIT',
                :amount, 'BRL', 'Linha sintética', '{}', 'mesma-impressao')
        RETURNING id
    """
    params = {"account": account, "file": file, "amount": Decimal("10.01")}
    first = insert(connection, statement, row=1, external_id=None, **params)
    second = insert(connection, statement, row=2, external_id=None, **params)
    assert first != second

    insert(connection, statement, row=3, external_id="banco-1", **params)
    with pytest.raises(IntegrityError), connection.begin_nested():
        insert(connection, statement, row=4, external_id="banco-1", **params)

    with pytest.raises(IntegrityError), connection.begin_nested():
        insert(connection, statement, row=4, external_id=None, **{**params, "amount": "10.001"})

    with pytest.raises(DBAPIError) as error, connection.begin_nested():
        connection.execute(
            text("UPDATE bank_transactions SET amount = 1 WHERE id = :id"), {"id": first}
        )
    assert error.value.orig.sqlstate == "55000"
