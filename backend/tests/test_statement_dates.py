"""Seleção de datas anterior à deduplicação; importações parciais rastreáveis."""

import base64
import json

import pytest
from sqlalchemy import event, text
from test_statement_reimport import upload
from test_statements import statements as statement_fixture  # noqa: F401
from test_transaction_exclusion import prepare

from app import statements as module


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def source(days=None, account="123456", name="datas-sinteticas.csv"):
    csv = (
        f"AGENCIA;0001;CONTA;{account}\n;;;;\n"
        "Data;Histórico;Documento;Valor (R$);Saldo (R$)\n"
        "24/01/2026;RECEBIMENTO SINTETICO A;01;100;200\n"
        "25/01/2026;DESPESA SINTETICA B;02;-30;170\n"
        "26/01/2026;RECEBIMENTO SINTETICO C;03;50;220\n"
    )
    result = {"file_name": name, "content": base64.b64encode(csv.encode()).decode()}
    if days is not None:
        result["selected_dates"] = days
    return result


def test_date_inspection_does_not_load_previous_movements_without_database():
    class AccountResult:
        def mappings(self):
            return [
                {
                    "id": "synthetic-account",
                    "active": True,
                    "label": "Conta sintética",
                    "code": "CTA-sintético",
                    "bank_code": "033",
                    "branch": "0001",
                    "account_number": "12345",
                    "account_digit": "6",
                    "currency": "BRL",
                }
            ]

    class Connection:
        def execute(self, sql, _params):
            assert "SELECT * FROM bank_accounts" in str(sql)
            return AccountResult()

    result, _ = module.build_preview(
        Connection(),
        "synthetic-org",
        module.StatementBatch(files=[source(["2026-01-25"])]),
        check_duplicates=False,
    )
    assert result["stage"] == "dates" and not result["ready"]
    assert result["files"][0]["selected_dates"] == ["2026-01-25"]
    assert result["files"][0]["selected_count"] == 1
    assert result["files"][0]["credits"] == "0.00"
    assert result["files"][0]["debits"] == "30.00"


def test_inspection_only_reads_dates_and_accounts_before_duplicate_checks(statements, monkeypatch):
    client, connection, base, _ = statements
    upload(client, base, [source(["2026-01-24"])])
    queries = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        queries.append(statement)

    event.listen(connection, "before_cursor_execute", capture)

    def forbidden(*_args, **_kwargs):
        pytest.fail("Duplicidades foram verificadas antes da seleção de datas")

    monkeypatch.setattr(module, "classify_rows", forbidden)
    response = client.post(base + "/statements/inspect", json={"files": [source()]})
    event.remove(connection, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["stage"] == "dates" and not data["ready"]
    assert data["files"][0]["date_options"] == [
        {"date": "2026-01-24", "count": 1, "credits": "100.00", "debits": "0.00"},
        {"date": "2026-01-25", "count": 1, "credits": "0.00", "debits": "30.00"},
        {"date": "2026-01-26", "count": 1, "credits": "50.00", "debits": "0.00"},
    ]
    assert data["files"][0]["rows"] == []
    assert not any("bank_transactions" in query or "import_files" in query for query in queries)


def test_unselected_dates_are_not_deduplicated_and_can_be_imported_later(statements, monkeypatch):
    client, connection, base, _ = statements
    first, result = upload(client, base, [source(["2026-01-24"])])
    assert result["imported"] == 1
    seen = []
    classify = module.classify_rows

    def record(rows, *args, **kwargs):
        seen.extend(row["posted_on"] for row in rows)
        return classify(rows, *args, **kwargs)

    monkeypatch.setattr(module, "classify_rows", record)
    second, result = upload(client, base, [source(["2026-01-25", "2026-01-26"])])
    assert set(seen) == {"2026-01-25", "2026-01-26"}
    assert second["new"] == result["imported"] == 2
    assert second["files"][0]["generation"] == 2
    assert second["files"][0]["credits"] == "50.00"
    assert second["files"][0]["debits"] == "30.00"
    assert (
        connection.scalar(
            text(
                "SELECT count(*) FROM bank_transactions t JOIN bank_accounts a ON a.id=t.account_id WHERE a.organization_id=:org"
            ),
            {"org": base.split("/")[2]},
        )
        == 3
    )
    again, result = upload(client, base, [source()])
    assert again["files"][0]["repeated"] and result["imported"] == 0
    audit = connection.scalar(
        text("SELECT new_json FROM audit_events WHERE entity_id=:batch"),
        {"batch": result["batch_id"]},
    )
    assert audit["date_selections"][0]["dates"] == ["2026-01-24", "2026-01-25", "2026-01-26"]
    assert first["files"][0]["selected_count"] == 1


def test_partial_files_in_same_batch_keep_independent_dates_and_generations(statements):
    client, _, base, _ = statements
    preview, result = upload(client, base, [source(["2026-01-24"]), source(["2026-01-25"])])
    assert result["imported"] == 2 and len(result["file_ids"]) == 2
    assert [item["generation"] for item in preview["files"]] == [1, 2]
    assert client.get(base + "/transactions?state=all").json()["total"] == 2


def test_multiple_accounts_and_date_choices_never_cross(statements):
    client, _, base, _ = statements
    pre, result = upload(
        client, base, [source(["2026-01-24"]), source(["2026-01-26"], account="789012")]
    )
    assert result["imported"] == 2
    assert pre["files"][0]["account_id"] != pre["files"][1]["account_id"]


@pytest.mark.parametrize("days", [[], ["2026-01-27"], ["inválida"]])
def test_empty_invalid_or_unavailable_dates_do_not_import(statements, days):
    client, _, base, _ = statements
    files = [source(days)]
    pre = client.post(base + "/statements/preview", json={"files": files})
    if not days:
        assert pre.status_code == 200 and not pre.json()["ready"]
    else:
        assert pre.status_code == 422
    result = client.post(
        base + "/statements/commit", json={"files": files, "token": pre.json().get("token")}
    )
    assert result.status_code == 422
    assert client.get(base + "/transactions?state=all").json()["total"] == 0


def test_changing_dates_invalidates_preview_and_inspection_cannot_be_committed(statements):
    client, _, base, _ = statements
    files = [source(["2026-01-24"])]
    pre = client.post(base + "/statements/preview", json={"files": files}).json()
    inspect = client.post(base + "/statements/inspect", json={"files": files}).json()
    assert (
        client.post(
            base + "/statements/commit", json={"files": files, "token": inspect["token"]}
        ).status_code
        == 409
    )
    assert (
        client.post(
            base + "/statements/commit",
            json={"files": [source(["2026-01-25"])], "token": pre["token"]},
        ).status_code
        == 409
    )


def test_excluding_partial_import_does_not_block_other_dates_or_restore_outside_selection(
    statements,
):
    client, connection, base, _ = statements
    upload(client, base, [source(["2026-01-24"])])
    row = client.get(base + "/transactions").json()["rows"][0]
    body, _ = prepare(client, base, [row["id"]])
    assert client.post(base + "/transaction-exclusions", json=body).status_code == 200
    pre, result = upload(client, base, [source(["2026-01-25"])])
    assert pre["new"] == result["imported"] == 1 and not pre["files"][0]["reimported"]
    pre, result = upload(client, base, [source(["2026-01-24"])])
    assert result["imported"] == pre["files"][0]["restored"] == 1
    assert client.get(base + "/transactions?state=all").json()["total"] == 2
    raw = connection.scalar(
        text("SELECT raw_payload FROM bank_transactions WHERE id=:id"), {"id": row["id"]}
    )
    assert raw["data"] == "2026-01-24"
    assert json.loads(json.dumps(raw))["valor"] == "100.00"
