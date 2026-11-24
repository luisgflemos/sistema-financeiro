from uuid import uuid4

import pytest
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app.planning import occurrence_date


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def new_plan(client, base, amount="100.00", direction="CREDIT", **kwargs):
    fields = dimensions(client, base, kind="REVENUE" if direction == "CREDIT" else "EXPENSE")
    fields.pop("movement_kind")
    payload = {
        **fields,
        "request_key": str(uuid4()),
        "description": "Compromisso sintético",
        "due_on": "2027-01-31",
        "direction": direction,
        "expected_amount": amount,
        **kwargs,
    }
    response = client.post(base + "/planned-entries", json=payload)
    assert response.status_code == 201, response.text
    return client.get(base + "/planned-entries").json()["rows"], payload


def link(client, base, plan, movement, **kwargs):
    return client.post(
        base + "/planned-entries/" + plan["id"] + "/settle",
        json={
            "transaction_id": movement["id"],
            "expected_transaction_version": movement["version"],
            "expected_entry_version": plan["version"],
            **kwargs,
        },
    )


def test_recurring_plans_are_idempotent_and_do_not_create_bank_movements(statements):
    client, connection, base, _ = statements
    rows, payload = new_plan(client, base, frequency="MONTHLY", occurrences=3)
    assert [row["due_on"] for row in rows] == ["2027-01-31", "2027-02-28", "2027-03-31"]
    assert [row["occurrence"] for row in rows] == [1, 2, 3]
    assert client.post(base + "/planned-entries", json=payload).json()["repeated"]
    assert client.get(base + "/planned-entries").json()["total"] == 3
    assert (
        client.post(
            base + "/planned-entries", json={**payload, "expected_amount": "200.00"}
        ).status_code
        == 409
    )
    assert (
        connection.scalar(
            text(
                "SELECT count(*) FROM bank_transactions t JOIN bank_accounts a ON a.id=t.account_id WHERE a.organization_id=:org"
            ),
            {"org": base.split("/")[2]},
        )
        == 0
    )
    assert client.get(base + "/planned-entries").json()["totals"]["receivable"] == "300.00"


def test_partial_settlement_reversal_and_direct_identification_guard(statements):
    client, _, base, _ = statements
    movements = imported(client, base)
    credit = next(row for row in movements if row["direction"] == "CREDIT")
    plans, _ = new_plan(client, base, amount="200.00")
    plan = plans[0]
    response = link(client, base, plan, credit)
    assert response.status_code == 200, response.text
    entry = response.json()["entry"]
    assert (entry["state"], entry["paid"], entry["outstanding"]) == ("partial", "100.00", "100.00")
    assert link(client, base, plan, credit).json()["repeated"]
    fields = dimensions(client, base)
    assert (
        client.put(
            base + "/transactions/" + credit["id"] + "/identification",
            json={**fields, "expected_version": 1},
        ).status_code
        == 409
    )
    assert (
        client.post(
            base + "/planned-entries/links/" + credit["id"] + "/reverse", json={}
        ).status_code
        == 200
    )
    updated = client.get(base + "/planned-entries").json()["rows"][0]
    assert (updated["state"], updated["paid"], updated["outstanding"]) == ("open", "0.00", "200.00")
    history = client.get(base + "/planned-entries/" + plan["id"] + "/settlements").json()
    assert history[0]["reversed"]
    assert client.get(base + "/transactions?state=all").json()["total"] == 4


def test_difference_requires_confirmation_and_preserves_expected(statements):
    client, _, base, _ = statements
    credit = next(row for row in imported(client, base) if row["direction"] == "CREDIT")
    plans, _ = new_plan(client, base, amount="80.00")
    assert link(client, base, plans[0], credit).status_code == 422
    response = link(client, base, plans[0], credit, confirm_difference=True)
    assert response.status_code == 200, response.text
    row = response.json()["entry"]
    assert (
        row["expected_amount"],
        row["paid"],
        row["difference"],
        row["outstanding"],
        row["state"],
    ) == ("80.00", "100.00", "20.00", "0.00", "realized")


def test_finish_short_payment_requires_confirmation(statements):
    client, _, base, _ = statements
    credit = next(row for row in imported(client, base) if row["direction"] == "CREDIT")
    plans, _ = new_plan(client, base, amount="120.00")
    assert link(client, base, plans[0], credit, finish=True).status_code == 422
    row = link(client, base, plans[0], credit, finish=True, confirm_difference=True).json()["entry"]
    assert (row["state"], row["difference"], row["outstanding"]) == ("realized", "-20.00", "0.00")


def test_matching_direction_organization_account_and_versions_are_required(statements):
    client, _, base, accounts = statements
    credit = next(row for row in imported(client, base) if row["direction"] == "CREDIT")
    plans, _ = new_plan(client, base, direction="DEBIT")
    assert link(client, base, plans[0], credit).status_code == 422
    plans, _ = new_plan(client, base, account_id=accounts[1])
    plan = next(row for row in plans if row["account_id"] == accounts[1])
    assert link(client, base, plan, credit).status_code == 422
    assert link(client, base, plan, credit, expected_entry_version=100).status_code == 409
    other = client.post("/organizations", json={"name": "Outra sintética"}).json()["id"]
    assert (
        client.get(
            f"/organizations/{other}/planned-entries/" + plan["id"] + "/settlements"
        ).status_code
        == 404
    )
    assert (
        client.get(f"/organizations/{other}/planned-entries/links/" + credit["id"]).status_code
        == 404
    )


def test_edit_cancel_and_decimal_validation(statements):
    client, _, base, _ = statements
    plans, payload = new_plan(client, base)
    plan = plans[0]
    editing = {
        key: value
        for key, value in payload.items()
        if key not in ("request_key", "frequency", "occurrences")
    }
    assert (
        client.put(
            base + "/planned-entries/" + plan["id"],
            json={**editing, "description": "Editado", "expected_version": 1},
        ).status_code
        == 200
    )
    assert (
        client.post(
            base + "/planned-entries/" + plan["id"] + "/cancel", json={"expected_version": 1}
        ).status_code
        == 409
    )
    assert (
        client.post(
            base + "/planned-entries/" + plan["id"] + "/cancel", json={"expected_version": 2}
        ).json()["state"]
        == "cancelled"
    )
    assert client.get(base + "/planned-entries").json()["totals"]["receivable"] == "0.00"
    for amount in ("0", "-1", "10.001"):
        assert (
            client.post(
                base + "/planned-entries",
                json={**payload, "request_key": str(uuid4()), "expected_amount": amount},
            ).status_code
            == 422
        )


def test_annual_leap_day_uses_original_anchor():
    from datetime import date

    assert occurrence_date(date(2028, 2, 29), "YEARLY", 1) == date(2029, 2, 28)
    assert occurrence_date(date(2028, 2, 29), "YEARLY", 4) == date(2032, 2, 29)
