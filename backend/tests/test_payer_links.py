import base64
from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_planning import link
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app.payer_links import payer_key, payer_name


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def payload(count=3, total="300.00", client="Cliente sintético", payer="CLIENTE SINTETICO"):
    raw = f"Pagador;Cliente;Quantidade;Total\n{payer};{client};{count};{total}\n"
    return {
        "file_name": "vinculos.csv",
        "content": base64.b64encode(raw.encode()).decode(),
        "through": "2026-01-02",
    }


def setup(statements):
    client, connection, base, _ = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    sub = client.post(
        base + "/subcategories", json={"name": "PIX Faturado", "category_id": values["category_id"]}
    ).json()
    values.update(party_id=None, subcategory_id=sub["id"], notes="Observação sintética")
    for row in rows:
        if row["direction"] == "CREDIT":
            assert (
                client.put(
                    base + f"/transactions/{row['id']}/identification", json=values
                ).status_code
                == 200
            )
    return client, connection, base, rows, values


def preview(client, base, body):
    response = client.post(base + "/payer-links/preview", json=body)
    assert response.status_code == 200, response.text
    return {**body, "token": response.json()["token"]}, response.json()


def test_batch_preserves_bank_dimensions_versions_and_learns_confirmed_party(statements):
    client, connection, base, rows, values = setup(statements)
    raw_before = (
        connection.execute(text("SELECT * FROM bank_transactions ORDER BY id")).mappings().all()
    )
    masters = client.get(base + "/parties").json()
    body, checked = preview(client, base, payload())
    assert checked["new"] == checked["count"] == 3
    result = client.post(base + "/payer-links/commit", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["linked"] == result.json()["verified"] == 3
    identified = client.get(base + "/transactions?state=identified").json()["rows"]
    for row in identified:
        assert row["party_id"] == masters[0]["id"] and row["version"] == 2
        assert all(
            row[k] == values[k]
            for k in ("category_id", "subcategory_id", "cost_center_id", "notes", "movement_kind")
        )
        assert row["method"] == "OPERATOR"
    assert (
        connection.execute(text("SELECT * FROM bank_transactions ORDER BY id")).mappings().all()
        == raw_before
    )
    assert client.get(base + "/parties").json() == masters
    assert len(rows) == 4
    assert (
        connection.scalar(text("SELECT count(*) FROM audit_events WHERE entity_type='payer_links'"))
        == 1
    )
    repeated, check = preview(client, base, payload())
    assert check["new"] == 0
    assert client.post(base + "/payer-links/commit", json=repeated).json()["linked"] == 0
    assert connection.scalar(text("SELECT count(*) FROM transaction_identifications")) == 6


def test_scope_count_totals_and_no_conflicting_overwrite(statements):
    client, _, base, rows, values = setup(statements)
    for wrong in (payload(count=2), payload(total="299.99"), payload(client="Ausente")):
        assert client.post(base + "/payer-links/preview", json=wrong).status_code in (409, 422)
    other = client.post("/organizations", json={"name": "Outra sintética"}).json()["id"]
    assert (
        client.post(f"/organizations/{other}/payer-links/preview", json=payload()).status_code
        == 422
    )
    body, _ = preview(client, base, payload())
    credit = next(r for r in rows if r["direction"] == "CREDIT")
    wrong = client.post(
        base + "/parties", json={"display_name": "Outro cliente sintético", "type": "CUSTOMER"}
    ).json()
    client.put(
        base + f"/transactions/{credit['id']}/identification",
        json={**values, "party_id": wrong["id"], "expected_version": 1},
    )
    assert client.post(base + "/payer-links/commit", json=body).status_code == 409
    current = client.get(base + "/transactions?state=identified").json()["rows"]
    assert sum(r["party_id"] is None for r in current) == 2


def test_stale_preview_and_file_changes_cannot_partially_commit(statements):
    client, connection, base, rows, values = setup(statements)
    body, _ = preview(client, base, payload())
    credit = next(r for r in rows if r["direction"] == "CREDIT")
    client.put(
        base + f"/transactions/{credit['id']}/identification",
        json={**values, "notes": "Mudou", "expected_version": 1},
    )
    assert client.post(base + "/payer-links/commit", json=body).status_code == 409
    fresh, _ = preview(client, base, payload())
    assert (
        client.post(
            base + "/payer-links/commit", json={**fresh, "through": "2026-01-03"}
        ).status_code
        == 409
    )
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_identifications WHERE party_id IS NOT NULL")
        )
        == 0
    )


def test_cutoff_subcategory_and_pending_are_not_silently_included(statements):
    client, connection, base, rows, values = setup(statements)
    credit = next(r for r in rows if r["direction"] == "CREDIT")
    connection.execute(
        text("""
        INSERT INTO bank_transactions(account_id,import_file_id,source_row,posted_on,direction,
          amount,currency,raw_description,raw_payload,fingerprint)
        SELECT account_id,import_file_id,1000,CAST('2026-01-03' AS date),direction,amount,currency,
          raw_description,raw_payload,'payer-future' FROM bank_transactions WHERE id=:id
    """),
        {"id": credit["id"]},
    )
    _, checked = preview(client, base, payload())
    assert checked["count"] == 3
    body, _ = preview(client, base, payload())
    assert client.post(base + "/payer-links/commit", json=body).status_code == 200
    assert client.get(base + "/transactions?state=pending").json()["total"] == 2
    assert date.fromisoformat(checked["through"]) == date(2026, 1, 2)
    assert Decimal(checked["total"]) == Decimal("300")
    assert values["party_id"] is None


def test_settlement_history_blocks_new_party_and_exclusions_stay_excluded(statements):
    client, _, base, rows, values = setup(statements)
    fields = {k: v for k, v in values.items() if k not in ("movement_kind", "notes")}
    created = client.post(
        base + "/planned-entries",
        json={
            **fields,
            "request_key": str(uuid4()),
            "description": "Previsto sintético",
            "due_on": "2026-01-02",
            "direction": "CREDIT",
            "expected_amount": "100.00",
        },
    )
    assert created.status_code == 201, created.text
    plans = client.get(base + "/planned-entries").json()["rows"]
    credit = next(
        r
        for r in client.get(base + "/transactions?state=identified").json()["rows"]
        if r["direction"] == "CREDIT"
    )
    assert link(client, base, plans[0], credit).status_code == 200
    blocked = client.post(base + "/payer-links/preview", json=payload())
    assert blocked.status_code == 409 and "baixa" in blocked.text
    other = next(r for r in rows if r["direction"] == "CREDIT" and r["id"] != credit["id"])
    exclusion = client.post(
        base + "/transaction-exclusions/preview", json={"ids": [other["id"]]}
    ).json()
    assert (
        client.post(
            base + "/transaction-exclusions",
            json={"ids": [other["id"]], "token": exclusion["token"]},
        ).status_code
        == 200
    )
    missing = client.post(base + "/payer-links/preview", json=payload())
    assert missing.status_code == 409 and "2 movimentos" in missing.text


@pytest.mark.parametrize(
    "description, expected",
    [
        ("TRANSFERENCIA PIX REM: Exemplo Ltda 02/01", "EXEMPLO LTDA"),
        ("PIX RECEBIDO REM: Exemplo Ltda 11/11", "EXEMPLO LTDA"),
        ("TRANSF CC PARA CC PJ Exemplo Ltda", "EXEMPLO LTDA"),
        ("TED RECEBIDA Exemplo Ltda", "EXEMPLO LTDA"),
        ("PIX RECEBIDO 123456", "123456"),
    ],
)
def test_name_cleanup_only_known_bank_prefixes(description, expected):
    assert payer_key(payer_name(description)) == expected
