import base64
import io
from datetime import datetime
from decimal import Decimal

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import imported

from app.historical_parser import parse_historical
from app.recognition import relevant_history


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def catalogs(client, base):
    center = client.post(base + "/cost-centers", json={"name": "Centro sintético"}).json()
    categories = {}
    for name, kind, sub in (
        ("Recebimento", "REVENUE", "PIX à Vista"),
        ("Despesas Gerais", "EXPENSE", "Fornecedor"),
        ("Transferência Bancária", "NEUTRAL", "Transferência Bancária"),
    ):
        category = client.post(base + "/categories", json={"name": name, "kind": kind}).json()
        child = client.post(
            base + "/subcategories", json={"name": sub, "category_id": category["id"]}
        ).json()
        categories[name] = (category, child)
    return center, categories


def upload(rows=None, inflated=False, metadata="Resumo sintético"):
    book = Workbook()
    book.active.title = "Resumo"
    book.active["A1"] = metadata
    sheet = book.create_sheet("LANÇAMENTOS")
    sheet.append(
        [
            "Unidade",
            "Data",
            "Lançamento",
            "Dcto.",
            "Crédito (R$)",
            "Débito (R$)",
            "Classificação",
            "Sub Classificação",
            "L/F/D",
            "MêsAno",
            "Centro de Custos",
        ]
    )
    default = [
        [
            "Conta A",
            datetime(2025, 1, 2),
            "PIX SINTETICO",
            "0001",
            100,
            None,
            "Recebimento",
            "PIX à Vista",
            "L",
            "202501",
            "Centro sintético",
        ],
        [
            "Conta A",
            datetime(2025, 1, 2),
            "PIX SINTETICO",
            "0001",
            100,
            None,
            "Recebimento",
            "PIX à Vista",
            "L",
            "202501",
            "Centro sintético",
        ],
        [
            "Conta A",
            datetime(2025, 1, 3),
            "PAGAMENTO SINTETICO",
            None,
            None,
            -30,
            "Despesas Gerais",
            "Fornecedor",
            "F",
            "202501",
            "Centro sintético",
        ],
        [
            "Conta B",
            datetime(2025, 1, 4),
            "TRANSFERENCIA SINTETICA",
            None,
            None,
            -50,
            "Transferência Bancária",
            "Transferência Bancária",
            "L",
            "202501",
            None,
        ],
    ]
    for row in rows if rows is not None else default:
        sheet.append(row)
    if inflated:
        sheet["R1048523"].number_format = "0.00"
    output = io.BytesIO()
    book.save(output)
    return {
        "file_name": "historico-sintetico.xlsx",
        "content": base64.b64encode(output.getvalue()).decode(),
    }


def test_parser_ignores_other_sheets_and_formatting_without_losing_occurrences():
    payload = upload(inflated=True)
    raw, name, rows = parse_historical(
        **{"file_name": payload["file_name"], "content": payload["content"]}
    )
    assert name == "LANÇAMENTOS"
    assert len(rows) == 4
    assert rows[0]["fingerprint"] == rows[1]["fingerprint"]
    assert rows[0]["row"] != rows[1]["row"]
    assert rows[3]["direction"] == "DEBIT" and rows[3]["amount"] == "50.00"
    assert load_workbook(io.BytesIO(raw), read_only=True).sheetnames == ["Resumo", "LANÇAMENTOS"]


def test_identified_history_is_atomic_preserves_catalogs_and_reimport_is_idempotent(statements):
    client, connection, base, accounts = statements
    center, categories = catalogs(client, base)
    before = {
        p: client.get(base + "/" + p).json()
        for p in (
            "bank-accounts",
            "categories",
            "subcategories",
            "cost-centers",
            "parties",
            "planned-entries",
        )
    }
    payload = upload()
    endpoint = base + "/historical-import"
    result = client.post(endpoint + "/preview", json=payload)
    assert result.status_code == 200, result.text
    preview = result.json()
    assert (preview["count"], preview["new"], preview["credits"], preview["debits"]) == (
        4,
        4,
        "200.00",
        "80.00",
    )
    assert client.get(base + "/transactions?state=all").json()["total"] == 0
    assert client.post(endpoint + "/commit", json={**payload, "token": "0" * 64}).status_code == 409
    response = client.post(endpoint + "/commit", json={**payload, "token": preview["token"]})
    assert response.status_code == 200, response.text
    assert response.json()["imported"] == 4
    assert len(response.json()["file_ids"]) == 2
    assert client.get(base + "/transactions?state=identified").json()["total"] == 4
    assert client.get(base + "/transactions?state=pending").json()["total"] == 0
    all_rows = client.get(base + "/transactions?state=all").json()["rows"]
    transfer = next(r for r in all_rows if r["account_id"] == accounts[1])
    assert transfer["movement_kind"] == "INTERNAL_TRANSFER" and transfer["cost_center_id"] is None
    assert all(
        r["party_id"] is None and r["version"] == 1 and r["method"] == "OPERATOR" for r in all_rows
    )
    assert sum(Decimal(r["amount"]) for r in all_rows if r["direction"] == "CREDIT") == Decimal(
        "200.00"
    )
    credits = [r for r in all_rows if r["direction"] == "CREDIT"]
    assert len({r["id"] for r in credits}) == 2
    assert {r["raw_payload"]["source_row"] for r in credits} == {2, 3}
    assert all(r["raw_payload"]["saldo"] is None for r in all_rows)
    assert all(r["raw_payload"]["source_sheet"] == "LANÇAMENTOS" for r in all_rows)
    for path, original in before.items():
        assert client.get(base + "/" + path).json() == original
    for part in client.get(endpoint + "/summary").json():
        assert part["count"] == part["identified"]
    assert (
        connection.scalar(
            text(
                "SELECT count(*) FROM audit_events WHERE organization_id=:org AND action='historical_identified_import'"
            ),
            {"org": base.split("/")[2]},
        )
        == 1
    )
    # Metadados do Excel mudaram, mas a carga financeira e suas ocorrências não.
    repeated_payload = upload(metadata="Resumo atualizado sem alterar movimentos")
    repeated = client.post(endpoint + "/preview", json=repeated_payload).json()
    assert repeated["new"] == 0
    assert (
        client.post(
            endpoint + "/commit", json={**repeated_payload, "token": repeated["token"]}
        ).json()["imported"]
        == 0
    )
    assert client.get(base + "/transactions?state=all").json()["total"] == 4
    assert (
        connection.scalar(
            text("SELECT count(*) FROM import_batches WHERE organization_id=:org"),
            {"org": base.split("/")[2]},
        )
        == 1
    )


def test_invalid_last_row_does_not_create_partial_import_or_catalogs(statements):
    client, _, base, _ = statements
    catalogs(client, base)
    original = upload()
    book = load_workbook(io.BytesIO(base64.b64decode(original["content"])))
    book["LANÇAMENTOS"]["K4"] = "Centro inexistente"
    output = io.BytesIO()
    book.save(output)
    bad = {**original, "content": base64.b64encode(output.getvalue()).decode()}
    for action in ("preview", "commit"):
        response = client.post(base + "/historical-import/" + action, json=bad)
        assert response.status_code == 422
        assert "Linha 4" in response.text
    assert client.get(base + "/transactions?state=all").json()["total"] == 0
    assert len(client.get(base + "/cost-centers").json()) == 1


@pytest.mark.parametrize(
    "cell,value",
    [("E2", -100), ("F2", -10), ("K2", None), ("G2", "Despesas Gerais"), ("H2", "Fornecedor")],
)
def test_invalid_sign_nature_parent_or_missing_center_is_rejected(statements, cell, value):
    client, _, base, _ = statements
    catalogs(client, base)
    data = upload()
    book = load_workbook(io.BytesIO(base64.b64decode(data["content"])))
    book["LANÇAMENTOS"][cell] = value
    output = io.BytesIO()
    book.save(output)
    data["content"] = base64.b64encode(output.getvalue()).decode()
    assert client.post(base + "/historical-import/preview", json=data).status_code == 422
    assert client.get(base + "/transactions?state=all").json()["total"] == 0


def test_existing_extratos_block_overlapping_initial_history(statements):
    client, _, base, _ = statements
    catalogs(client, base)
    imported(client, base)
    assert client.post(base + "/historical-import/preview", json=upload()).status_code == 409
    assert client.get(base + "/transactions?state=all").json()["total"] == 4


def test_relevant_examples_are_selected_beyond_recent_500():
    recent = [
        {"account_id": "other", "direction": "DEBIT", "raw_description": f"OUTRO {n}"}
        for n in range(600)
    ]
    old = {
        "account_id": "target",
        "direction": "CREDIT",
        "raw_description": "PIX CLIENTE SINTETICO",
    }
    history = recent + [old]
    assert relevant_history(history, [old], limit=1) == [old]
