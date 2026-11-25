from uuid import uuid4

import pytest
from sqlalchemy import text
from test_planning import link, new_plan
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def selection(client, base, row, scope="current"):
    response = client.get(base + f"/planned-entries/{row['id']}/exclusion-preview?scope={scope}")
    assert response.status_code == 200, response.text
    preview = response.json()
    return {
        "scope": scope,
        "expected_version": preview["version"],
        "expected_revision": preview["revision"],
    }, preview


def remove(client, base, row, body):
    return client.post(base + f"/planned-entries/{row['id']}/exclude", json=body)


def test_cancelled_can_be_filtered_then_excluded_without_erasing_history(statements):
    client, connection, base, _ = statements
    rows, _ = new_plan(client, base)
    row = rows[0]
    response = client.post(
        base + f"/planned-entries/{row['id']}/cancel", json={"expected_version": row["version"]}
    )
    assert response.status_code == 200
    cancelled = response.json()
    assert cancelled["state"] == "cancelled" and cancelled["can_delete"]
    assert client.get(base + "/planned-entries?state=active").json()["total"] == 0
    assert client.get(base + "/planned-entries?state=all").json()["total"] == 1
    assert (
        client.get(base + "/planned-entries?state=cancelled").json()["totals"]["receivable"]
        == "0.00"
    )
    body, preview = selection(client, base, cancelled)
    assert preview["count"] == 1 and preview["blocked"] == 0
    assert remove(client, base, cancelled, body).json() == {"excluded": 1}
    assert client.get(base + "/planned-entries?state=all").json()["total"] == 0
    assert client.get(base + "/planned-entries?state=cancelled").json()["total"] == 0
    assert connection.scalar(
        text("SELECT deleted_at IS NOT NULL FROM planned_entries WHERE id=:id"), {"id": row["id"]}
    )
    assert (
        connection.scalar(
            text(
                "SELECT count(*) FROM audit_events WHERE entity_id=:id AND action IN ('cancel','exclude')"
            ),
            {"id": row["id"]},
        )
        == 2
    )


def test_recurring_exclusion_preserves_previous_occurrences_and_idempotent_series(statements):
    client, connection, base, _ = statements
    rows, payload = new_plan(client, base, frequency="MONTHLY", occurrences=4)
    body, preview = selection(client, base, rows[1], "following")
    assert preview["count"] == 3
    assert remove(client, base, rows[1], body).json() == {"excluded": 3}
    left = client.get(base + "/planned-entries?state=all").json()
    assert [row["id"] for row in left["rows"]] == [rows[0]["id"]]
    assert left["totals"]["receivable"] == "100.00"
    assert (
        connection.scalar(
            text("SELECT count(*) FROM planned_entries WHERE series_id=:series"),
            {"series": rows[0]["series_id"]},
        )
        == 4
    )
    assert client.post(base + "/planned-entries", json=payload).json()["repeated"]
    assert client.get(base + "/planned-entries").json()["total"] == 1
    body, _ = selection(client, base, rows[0])
    assert remove(client, base, rows[0], {**body, "expected_version": 999}).status_code == 409
    other = client.post("/organizations", json={"name": "Outra sintética"}).json()["id"]
    assert remove(client, f"/organizations/{other}", rows[0], body).status_code == 404
    assert remove(client, base, {"id": str(uuid4())}, body).status_code == 404


def test_baixas_block_entire_selection_and_changed_preview_is_rejected(statements):
    client, connection, base, _ = statements
    movement = next(row for row in imported(client, base) if row["direction"] == "CREDIT")
    rows, _ = new_plan(client, base, frequency="MONTHLY", occurrences=4)
    before, _ = selection(client, base, rows[0], "following")
    assert link(client, base, rows[2], movement).status_code == 200
    assert remove(client, base, rows[0], before).status_code == 409
    body, preview = selection(client, base, rows[0], "following")
    assert preview["blocked"] == 1
    assert remove(client, base, rows[0], body).status_code == 409
    assert client.get(base + "/planned-entries").json()["total"] == 4
    assert connection.scalar(text("SELECT count(*) FROM audit_events WHERE action='exclude'")) == 0
    assert (
        client.post(base + f"/planned-entries/links/{movement['id']}/reverse", json={}).status_code
        == 200
    )
    body, preview = selection(client, base, rows[0], "following")
    assert preview["blocked"] == 1, "Histórico de baixas permanece protegido após reversão"
    assert remove(client, base, rows[0], body).status_code == 409
    single, _ = selection(client, base, rows[0])
    assert remove(client, base, rows[0], single).status_code == 200
    assert client.get(base + f"/planned-entries/{rows[0]['id']}/settlements").status_code == 404
    assert (
        client.post(
            base + f"/planned-entries/{rows[0]['id']}/cancel",
            json={"expected_version": rows[0]["version"]},
        ).status_code
        == 404
    )
    assert client.get(base + "/transactions?state=all").json()["total"] == 2
