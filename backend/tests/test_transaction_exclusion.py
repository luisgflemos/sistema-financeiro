from uuid import uuid4

import pytest
from sqlalchemy import text
from test_planning import link, new_plan
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app.history_context import load_history


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def prepare(client, base, ids):
    response = client.post(base + "/transaction-exclusions/preview", json={"ids": ids})
    assert response.status_code == 200, response.text
    return {"ids": ids, "token": response.json()["token"]}, response.json()


def test_exclusion_preserves_originals_masters_and_hides_all_views(statements):
    client, connection, base, _ = statements
    rows = imported(client, base)
    current = next(r for r in rows if r["direction"] == "CREDIT")
    values = dimensions(client, base)
    assert (
        client.put(base + f"/transactions/{current['id']}/identification", json=values).status_code
        == 200
    )
    body, preview = prepare(client, base, [current["id"]])
    assert preview["identified"] == 1 and preview["count"] == 1
    assert client.post(base + "/transaction-exclusions", json=body).json() == {"removed": 1}
    assert client.get(base + "/transactions?state=all").json()["total"] == 3
    file_rows = client.get(
        base + "/transactions?state=all&statement_id=" + current["import_file_id"]
    ).json()["rows"]
    assert current["id"] not in {r["id"] for r in file_rows}
    assert (
        client.put(base + f"/transactions/{current['id']}/identification", json=values).status_code
        == 404
    )
    assert (
        client.post(base + "/recognition/run", json={"transaction_id": current["id"]}).status_code
        == 404
    )
    assert len(load_history(connection, base.split("/")[2])) == 3
    assert (
        connection.scalar(
            text("SELECT count(*) FROM bank_transactions WHERE id=:id"), {"id": current["id"]}
        )
        == 1
    )
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_identifications WHERE transaction_id=:id"),
            {"id": current["id"]},
        )
        == 1
    )
    assert client.get(base + "/parties").json()[0]["id"] == values["party_id"]
    assert client.post(base + "/transaction-exclusions", json=body).status_code == 409
    # Reimportar os mesmos bytes não ressuscita movimentos excluídos.
    imported(client, base)
    assert client.get(base + "/transactions?state=all").json()["total"] == 3


def test_scope_preview_revision_and_settlements_block_atomic_exclusion(statements):
    client, connection, base, _ = statements
    rows = imported(client, base)
    current = next(r for r in rows if r["direction"] == "CREDIT")
    body, _ = prepare(client, base, [current["id"], rows[-1]["id"]])
    other = client.post("/organizations", json={"name": "Outra sintética"}).json()["id"]
    assert (
        client.post(f"/organizations/{other}/transaction-exclusions", json=body).status_code == 409
    )
    invalid = {**body, "ids": [current["id"], str(uuid4())]}
    assert client.post(base + "/transaction-exclusions", json=invalid).status_code == 409
    plans, _ = new_plan(client, base)
    assert link(client, base, plans[0], current).status_code == 200
    assert client.post(base + "/transaction-exclusions", json=body).status_code == 409
    fresh, summary = prepare(client, base, body["ids"])
    assert summary["blocked"] == 1
    assert client.post(base + "/transaction-exclusions", json=fresh).status_code == 409
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_exclusions WHERE organization_id=:org"),
            {"org": base.split("/")[2]},
        )
        == 0
    )


def test_select_all_respects_filters_and_has_no_page_limit(statements):
    client, connection, base, _ = statements
    rows = imported(client, base)
    # Fixtures sintéticas adicionais para provar seleção além da página de 100.
    connection.execute(
        text("""
        INSERT INTO bank_transactions(account_id,import_file_id,source_row,posted_on,direction,
            amount,currency,raw_description,raw_payload,fingerprint)
        SELECT account_id,import_file_id,1000+n,posted_on,'CREDIT',1,'BRL',
            'SELECAO SINTETICA','{}'::jsonb,'synthetic-'||n
        FROM bank_transactions CROSS JOIN generate_series(1,105) n WHERE id=:id
    """),
        {"id": rows[0]["id"]},
    )
    connection.commit()
    url = base + "/transactions?state=all&query=SELECAO&direction=CREDIT"
    page = client.get(url).json()
    assert page["total"] == 105 and len(page["rows"]) == 100
    selected = client.get(url + "&selection_only=true").json()
    assert selected["total"] == len(selected["ids"]) == 105
    assert client.get(url + "&direction=DEBIT&selection_only=true").json()["total"] == 0
