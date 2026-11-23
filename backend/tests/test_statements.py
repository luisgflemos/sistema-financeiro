import base64
import io
from decimal import Decimal

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import text

from app.statement_parser import parse_statement


def count_movements(connection, base):
    return connection.scalar(
        text("""
        SELECT count(*) FROM bank_transactions t JOIN bank_accounts a ON a.id=t.account_id
        WHERE a.organization_id=:org
    """),
        {"org": base.split("/")[2]},
    )


def source(
    account="123456", branch="0001", name="extrato-sintetico.xlsx", trailing=False, single=False
):
    book = Workbook()
    sheet = book.active
    sheet.append(["AGENCIA", branch, "CONTA", account])
    sheet.append([])
    sheet.append(["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"])
    sheet.append(["02/01/2026", "PIX RECEBIDO CLIENTE SINTETICO", "00001", 100, 220])
    if not single:
        sheet.append(["02/01/2026", "PIX ENVIADO FORNECEDOR SINTETICO", "00001", -30, 120])
        sheet.append(["02/01/2026", "PIX RECEBIDO CLIENTE SINTETICO", "00001", 100, 150])
        sheet.append(["02/01/2026", "PIX RECEBIDO CLIENTE SINTETICO", "00001", 100, 50])
    if trailing:
        sheet.append(["", "", "", "", ""])
    output = io.BytesIO()
    book.save(output)
    return {"file_name": name, "content": base64.b64encode(output.getvalue()).decode()}


@pytest.fixture
def statements(catalog_client):
    client, connection = catalog_client
    organization = client.post("/organizations", json={"name": "Extratos sintéticos"}).json()["id"]
    base = f"/organizations/{organization}"
    accounts = []
    for name, number, digit in (("Conta A", "12345", "6"), ("Conta B", "78901", "2")):
        response = client.post(
            base + "/bank-accounts",
            json={
                "label": name,
                "bank_code": "033",
                "branch": "0001",
                "account_number": number,
                "account_digit": digit,
                "currency": "BRL",
                "active": True,
            },
        )
        assert response.status_code == 201, response.text
        accounts.append(response.json()["id"])
    return client, connection, base, accounts


def test_parser_preserves_repeated_documents_and_distinct_occurrences():
    upload = source()
    statement = parse_statement(upload["file_name"], upload["content"])
    assert len(statement.movements) == 4
    assert statement.summary()["credits"] == "300.00"
    assert statement.summary()["debits"] == "30.00"
    assert statement.movements[0].fingerprint() == statement.movements[2].fingerprint()
    assert statement.movements[1].signed_amount == Decimal("-30.00")


def test_multiple_files_accounts_and_original_bytes(statements):
    client, connection, base, accounts = statements
    payload = {"files": [source(), source(account="789012", name="segundo.xlsx")]}
    preview = client.post(base + "/statements/preview", json=payload)
    assert preview.status_code == 200, preview.text
    result = preview.json()
    assert [item["account_id"] for item in result["files"]] == accounts
    assert result["new"] == 8
    assert count_movements(connection, base) == 0
    response = client.post(base + "/statements/commit", json={**payload, "token": result["token"]})
    assert response.status_code == 200, response.text
    assert response.json()["imported"] == 8
    assert count_movements(connection, base) == 8
    originals = (
        connection.execute(text("SELECT original_bytes FROM statement_contents")).scalars().all()
    )
    assert base64.b64decode(payload["files"][0]["content"]) in [bytes(value) for value in originals]
    rows = client.get(base + "/transactions").json()
    assert rows["total"] == 8
    assert all(item["amount"] in ("100.00", "30.00") for item in rows["rows"])
    repeat = client.post(base + "/statements/preview", json=payload).json()
    assert repeat["new"] == 0
    assert all(item["repeated"] for item in repeat["files"])
    assert (
        client.post(base + "/statements/commit", json={**payload, "token": repeat["token"]}).json()[
            "imported"
        ]
        == 0
    )
    assert count_movements(connection, base) == 8


def test_isolated_overlap_without_sequence_requires_confirmation(statements):
    client, connection, base, _ = statements
    first = {"files": [source()]}
    preview = client.post(base + "/statements/preview", json=first).json()
    client.post(base + "/statements/commit", json={**first, "token": preview["token"]})
    overlap = {"files": [source(single=True)]}
    result = client.post(base + "/statements/preview", json=overlap).json()
    assert result["files"][0]["pending"] == 1
    assert not result["ready"]
    assert (
        client.post(
            base + "/statements/commit", json={**overlap, "token": result["token"]}
        ).status_code
        == 422
    )
    overlap["files"][0]["decisions"] = {"4": "skip"}
    result = client.post(base + "/statements/preview", json=overlap).json()
    assert result["ready"]
    assert (
        client.post(base + "/statements/commit", json={**overlap, "token": result["token"]}).json()[
            "imported"
        ]
        == 0
    )
    assert count_movements(connection, base) == 4


def test_wrong_account_or_bad_second_file_never_partially_import(statements):
    client, connection, base, accounts = statements
    wrong = source()
    wrong["account_id"] = accounts[1]
    assert client.post(base + "/statements/preview", json={"files": [wrong]}).status_code == 422
    bad = {
        "file_name": "invalido.xlsx",
        "content": base64.b64encode(b"invalid").decode(),
    }
    assert (
        client.post(
            base + "/statements/commit", json={"files": [source(), bad], "token": "x"}
        ).status_code
        == 422
    )
    assert (
        connection.scalar(
            text("SELECT count(*) FROM import_batches WHERE organization_id=:org"),
            {"org": base.split("/")[2]},
        )
        == 0
    )


def test_same_file_twice_in_batch_is_not_duplicated(statements):
    client, _, base, _ = statements
    upload = source()
    payload = {"files": [upload, upload]}
    preview = client.post(base + "/statements/preview", json=payload).json()
    assert preview["new"] == 4
    assert preview["files"][1]["repeated"]
    response = client.post(base + "/statements/commit", json={**payload, "token": preview["token"]})
    assert response.json()["imported"] == 4


@pytest.mark.parametrize("cell", ["A4", "B4", "D4"])
def test_date_description_and_amount_are_required_from_source(cell):
    upload = source()
    book = load_workbook(io.BytesIO(base64.b64decode(upload["content"])))
    book.active[cell] = None
    output = io.BytesIO()
    book.save(output)
    with pytest.raises(ValueError, match="Linha 4"):
        parse_statement(upload["file_name"], base64.b64encode(output.getvalue()).decode())


def test_overlapping_bank_sequence_is_resolved_automatically(statements):
    client, connection, base, _ = statements
    first = {"files": [source()]}
    preview = client.post(base + "/statements/preview", json=first).json()
    client.post(base + "/statements/commit", json={**first, "token": preview["token"]})
    overlap = {"files": [source(trailing=True)]}
    result = client.post(base + "/statements/preview", json=overlap).json()
    assert result["ready"]
    assert result["new"] == 0
    assert result["files"][0]["duplicates"] == 4
    assert result["files"][0]["pending"] == 0
    assert (
        client.post(base + "/statements/commit", json={**overlap, "token": result["token"]}).json()[
            "imported"
        ]
        == 0
    )
    assert count_movements(connection, base) == 4


def test_additional_identical_payment_is_preserved_when_prior_occurrences_are_located(statements):
    client, connection, base, _ = statements
    first = {"files": [source()]}
    preview = client.post(base + "/statements/preview", json=first).json()
    client.post(base + "/statements/commit", json={**first, "token": preview["token"]})
    upload = source()
    book = load_workbook(io.BytesIO(base64.b64decode(upload["content"])))
    book.active.insert_rows(4)
    for column, value in enumerate(
        ["02/01/2026", "PIX RECEBIDO CLIENTE SINTETICO", "00001", 100, 320], 1
    ):
        book.active.cell(4, column, value)
    output = io.BytesIO()
    book.save(output)
    upload["content"] = base64.b64encode(output.getvalue()).decode()
    result = client.post(base + "/statements/preview", json={"files": [upload]}).json()
    assert result["ready"]
    assert result["new"] == 1
    assert result["files"][0]["duplicates"] == 4
    assert (
        client.post(
            base + "/statements/commit", json={"files": [upload], "token": result["token"]}
        ).json()["imported"]
        == 1
    )
    assert count_movements(connection, base) == 5
