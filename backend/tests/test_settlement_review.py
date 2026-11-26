from uuid import uuid4

import pytest
from sqlalchemy import text
from test_planning import link, new_plan
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


@pytest.mark.parametrize("direction", ["CREDIT", "DEBIT"])
@pytest.mark.parametrize(
    "amount,treatment,discount,surcharge,outstanding",
    [
        ("120.00", "KEEP_OPEN", "0.00", "0.00", "20.00"),
        ("120.00", "DISCOUNT", "20.00", "0.00", "0.00"),
        ("80.00", "SURCHARGE", "0.00", "20.00", "0.00"),
    ],
)
def test_cash_is_fixed_adjustments_are_explicit_and_reversible(
    statements, direction, amount, treatment, discount, surcharge, outstanding
):
    client, conn, base, _ = statements
    credit = next(r for r in imported(client, base) if r["direction"] == direction)
    cash = credit["amount"]
    # O débito sintético também tem 100,00? Usar saldo relativo ao dinheiro do extrato.
    from decimal import Decimal

    expected = Decimal(cash) + (20 if amount == "120.00" else -20)
    rows, _ = new_plan(client, base, amount=str(expected), direction=direction)
    plan = rows[0]
    path = base + "/planned-entries/" + plan["id"]
    if treatment != "KEEP_OPEN":
        assert link(client, base, plan, credit, difference_treatment=treatment).status_code == 422
        assert client.get(path + "/settlements").json() == []
    response = link(
        client, base, plan, credit, difference_treatment=treatment, confirm_difference=True
    )
    assert response.status_code == 200, response.text
    updated = response.json()["entry"]
    assert updated["paid"] == cash
    assert (updated["discount"], updated["surcharge"], updated["outstanding"]) == (
        discount,
        surcharge,
        outstanding,
    )
    assert updated["expected_amount"] == f"{expected:.2f}"
    assert link(
        client, base, plan, credit, difference_treatment=treatment, confirm_difference=True
    ).json()["repeated"]
    assert client.get(path + "/settlements").json()[0]["review_json"]["treatment"] == treatment
    assert conn.scalar(
        text("SELECT amount FROM bank_transactions WHERE id=:id"), {"id": credit["id"]}
    ) == Decimal(cash)
    assert (
        client.post(
            base + "/planned-entries/links/" + credit["id"] + "/reverse", json={}
        ).status_code
        == 200
    )
    restored = client.get(base + "/planned-entries").json()["rows"][0]
    assert (
        restored["paid"],
        restored["discount"],
        restored["surcharge"],
        restored["outstanding"],
    ) == ("0.00", "0.00", "0.00", f"{expected:.2f}")


def test_review_overrides_identification_without_changing_title(statements):
    client, _, base, _ = statements
    credit = next(r for r in imported(client, base) if r["direction"] == "CREDIT")
    rows, _ = new_plan(client, base, cost_center_id=None)
    plan = rows[0]
    assert plan["cost_center_id"] is None
    assert link(client, base, plan, credit).status_code == 422
    fields = dimensions(client, base, kind="REVENUE")
    fields.pop("movement_kind")
    response = link(client, base, plan, credit, **fields)
    assert response.status_code == 200, response.text
    assert response.json()["entry"]["cost_center_id"] is None
    movement = next(
        r
        for r in client.get(base + "/transactions?state=all").json()["rows"]
        if r["id"] == credit["id"]
    )
    assert movement["cost_center_id"] == fields["cost_center_id"]
    assert response.json()["entry"]["category_id"] == plan["category_id"]
    assert (
        link(client, base, plan, credit, **{**fields, "notes": "Alteração tardia"}).status_code
        == 409
    )


def test_suggestions_use_exact_client_and_full_open_balance(statements):
    client, _, base, _ = statements
    credit = next(r for r in imported(client, base) if r["direction"] == "CREDIT")
    party = client.post(
        base + "/parties", json={"display_name": "Cliente sintético", "type": "CUSTOMER"}
    ).json()
    other = client.post(
        base + "/parties", json={"display_name": "Outra pessoa", "type": "CUSTOMER"}
    ).json()
    _, payload = new_plan(client, base, party_id=party["id"], due_on="2026-01-01")
    new_plan(client, base, amount="130.00", party_id=party["id"])
    new_plan(client, base, party_id=other["id"])
    path = base + "/planned-entries/suggestions/" + credit["id"]
    assert client.get(path).json()["rows"] == []
    result = client.get(path, params={"party_id": party["id"]}).json()["rows"]
    assert len(result) == 2
    assert result[0]["confidence"] == "HIGH" and result[1]["confidence"] == "MEDIUM"
    assert all(r["party_id"] == party["id"] for r in result)
    # Mais de um título de mesmo valor: não declarar certeza de qual título foi pago.
    client.post(base + "/planned-entries", json={**payload, "request_key": str(uuid4())})
    assert all(
        r["confidence"] == "MEDIUM"
        for r in client.get(path, params={"party_id": party["id"]}).json()["rows"]
    )


def test_due_status_filters_and_partial_badge_data(statements):
    client, _, base, _ = statements
    new_plan(client, base, due_on="2000-01-01")
    new_plan(client, base, due_on="2099-01-01")
    overdue = client.get(base + "/planned-entries?state=overdue").json()
    upcoming = client.get(base + "/planned-entries?state=upcoming").json()
    assert overdue["total"] == upcoming["total"] == 1
    assert overdue["rows"][0]["situation"] == "overdue"
    assert upcoming["rows"][0]["situation"] == "upcoming"


def test_supplier_suggestions_follow_current_unconfirmed_party(statements):
    client, _, base, _ = statements
    debit = next(r for r in imported(client, base) if r["direction"] == "DEBIT")
    supplier = client.post(
        base + "/parties", json={"display_name": "Fornecedor Alfa", "type": "SUPPLIER"}
    ).json()
    rows, _ = new_plan(
        client, base, amount=debit["amount"], direction="DEBIT", party_id=supplier["id"]
    )
    path = base + "/planned-entries/suggestions/" + debit["id"]
    result = client.get(path, params={"party_id": supplier["id"], "derive_party": False}).json()[
        "rows"
    ]
    assert len(result) == 1 and result[0]["id"] == rows[0]["id"]
    assert result[0]["confidence"] == "HIGH"
    assert client.get(path, params={"derive_party": False}).json()["rows"] == []
    assert all(
        r["version"] == 0 for r in client.get(base + "/transactions?state=all").json()["rows"]
    )


def test_invalid_review_is_atomic_and_org_isolated(statements):
    client, _, base, _ = statements
    credit = next(r for r in imported(client, base) if r["direction"] == "CREDIT")
    rows, _ = new_plan(client, base)
    plan = rows[0]
    other = client.post("/organizations", json={"name": "Outra organização sintética"}).json()["id"]
    foreign = client.post(
        f"/organizations/{other}/cost-centers", json={"name": "Centro externo"}
    ).json()
    assert link(client, base, plan, credit, cost_center_id=foreign["id"]).status_code == 422
    assert client.get(base + "/planned-entries/" + plan["id"] + "/settlements").json() == []
    assert client.get(base + "/planned-entries").json()["rows"][0]["version"] == 1
    assert all(
        r["version"] == 0 for r in client.get(base + "/transactions?state=all").json()["rows"]
    )
