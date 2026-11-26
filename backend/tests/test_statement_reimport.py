import base64

import pytest
from sqlalchemy import text
from test_statements import source
from test_statements import statements as statement_fixture  # noqa: F401
from test_transaction_exclusion import prepare
from test_transactions import dimensions, imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def upload(client, base, files):
    preview = client.post(base + "/statements/preview", json={"files": files})
    assert preview.status_code == 200, preview.text
    result = client.post(
        base + "/statements/commit", json={"files": files, "token": preview.json()["token"]}
    )
    assert result.status_code == 200, result.text
    return preview.json(), result.json()


def original_source(connection, row):
    # XLSX inclui timestamps ZIP; recriar o workbook pode mudar o hash.
    # Estes cenários verificam o mesmo arquivo, portanto reutilizam seus bytes.
    raw = connection.scalar(
        text("SELECT original_bytes FROM statement_contents WHERE import_file_id=:id"),
        {"id": row["import_file_id"]},
    )
    return {"file_name": "extrato-sintetico.xlsx", "content": base64.b64encode(raw).decode()}


def test_partial_reimport_keeps_active_identifications_and_repeated_occurrences(statements):
    client, conn, base, _ = statements
    rows = imported(client, base)
    original_file = original_source(conn, rows[0])
    credits = [r for r in rows if r["direction"] == "CREDIT"]
    values = dimensions(client, base)
    for row in credits[:2]:
        assert (
            client.put(base + f"/transactions/{row['id']}/identification", json=values).status_code
            == 200
        )
    body, _ = prepare(client, base, [credits[0]["id"]])
    assert client.post(base + "/transaction-exclusions", json=body).json()["removed"] == 1
    pre, result = upload(client, base, [original_file])
    assert pre["new"] == result["imported"] == pre["files"][0]["restored"] == 1
    assert pre["files"][0]["duplicates"] == 3
    assert pre["files"][0]["pending"] == 0 and pre["files"][0]["reimported"]
    active = client.get(base + "/transactions?state=all").json()["rows"]
    assert len(active) == 4 and len({r["id"] for r in active}) == 4
    assert credits[0]["id"] not in {r["id"] for r in active}
    fresh = next(r for r in active if r["id"] not in {old["id"] for old in rows})
    assert fresh["version"] == 0 and fresh["suggestion_id"] is None
    assert fresh["raw_payload"]["reimported_from_transaction_id"] == credits[0]["id"]
    assert next(r for r in active if r["id"] == credits[1]["id"])["party_id"] == values["party_id"]
    assert (
        conn.scalar(
            text("SELECT count(*) FROM bank_transactions WHERE account_id=:id"),
            {"id": rows[0]["account_id"]},
        )
        == 5
    )
    pre2, result2 = upload(client, base, [original_file])
    assert pre2["files"][0]["repeated"] and result2["imported"] == 0
    assert client.get(base + "/transactions?state=all").json()["total"] == 4


def test_full_exclusion_reimport_same_batch_is_idempotent_and_can_repeat_cycle(statements):
    client, conn, base, _ = statements
    original = imported(client, base)
    original_file = original_source(conn, original[0])
    for cycle in range(2):
        rows = client.get(base + "/transactions?state=all").json()["rows"]
        body, summary = prepare(client, base, [r["id"] for r in rows])
        assert summary["blocked"] == 0
        assert client.post(base + "/transaction-exclusions", json=body).json()["removed"] == 4
        pre, result = upload(client, base, [original_file, original_file])
        assert pre["new"] == result["imported"] == 4
        assert pre["files"][0]["generation"] == cycle + 2
        assert pre["files"][1]["repeated"]
        assert len(result["file_ids"]) == 1
        assert client.get(base + "/transactions?state=pending").json()["total"] == 4
    assert (
        conn.scalar(
            text("SELECT count(*) FROM bank_transactions WHERE account_id=:id"),
            {"id": original[0]["account_id"]},
        )
        == 12
    )


def test_exclusion_after_preview_invalidates_token_and_never_crosses_accounts(statements):
    client, connection, base, _ = statements
    rows = imported(client, base)
    files = [original_source(connection, rows[0])]
    pre = client.post(base + "/statements/preview", json={"files": files}).json()
    body, _ = prepare(client, base, [rows[0]["id"]])
    assert client.post(base + "/transaction-exclusions", json=body).status_code == 200
    assert (
        client.post(
            base + "/statements/commit", json={"files": files, "token": pre["token"]}
        ).status_code
        == 409
    )
    other, result = upload(client, base, [source(account="789012")])
    assert not other["files"][0]["reimported"] and result["imported"] == 4
    assert client.get(base + "/transactions?state=all").json()["total"] == 7
