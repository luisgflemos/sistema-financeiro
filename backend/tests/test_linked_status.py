import pytest
from test_planning import link, new_plan
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


@pytest.mark.parametrize("direction", ["CREDIT", "DEBIT"])
def test_linked_filter_uses_active_settlement_and_reversal(statements, direction):
    client, _, base, _ = statements
    movement = next(row for row in imported(client, base) if row["direction"] == direction)
    plans, _ = new_plan(client, base, amount=movement["amount"], direction=direction)
    path = base + "/transactions?state=linked"
    assert client.get(path).json()["total"] == 0
    assert link(client, base, plans[0], movement).status_code == 200
    result = client.get(path).json()
    assert result["total"] == 1
    assert result["rows"][0]["id"] == movement["id"]
    assert result["rows"][0]["planning_description"] == plans[0]["description"]
    assert result["rows"][0]["amount"] == movement["amount"]
    assert client.get(path + "&selection_only=true").json()["ids"] == [movement["id"]]
    assert (
        client.get(path + "&direction=" + ("DEBIT" if direction == "CREDIT" else "CREDIT")).json()[
            "total"
        ]
        == 0
    )
    assert client.get(base + "/transactions?state=identified").json()["total"] == 1
    assert (
        client.post(
            base + "/planned-entries/links/" + movement["id"] + "/reverse", json={}
        ).status_code
        == 200
    )
    assert client.get(path).json()["total"] == 0
    row = next(
        r
        for r in client.get(base + "/transactions?state=identified").json()["rows"]
        if r["id"] == movement["id"]
    )
    assert row["planning_description"] is None
    assert row["state"] == "identified"
