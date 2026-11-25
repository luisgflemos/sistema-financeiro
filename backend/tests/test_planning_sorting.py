from decimal import Decimal

import pytest
from test_planning import link, new_plan
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def test_planning_sorts_all_filtered_results_before_pagination(statements):
    client, _, base, _ = statements
    for name, amount in [("Zeta", "1000.00"), ("Beta", "20.00"), ("Alfa", "300.00")]:
        new_plan(client, base, amount=amount, description=name, frequency="MONTHLY", occurrences=80)
    original = client.get(base + "/planned-entries").json()["totals"]
    for field in ("due_on", "description", "expected_amount", "outstanding"):
        for order in ("asc", "desc"):
            rows = []
            for page in (1, 2, 3):
                result = client.get(
                    base + f"/planned-entries?sort_by={field}&sort_order={order}&page={page}"
                ).json()
                assert result["total"] == 240 and result["totals"] == original
                rows.extend(result["rows"])
            assert len({r["id"] for r in rows}) == 240
            values = [
                Decimal(r[field])
                if field in ("expected_amount", "outstanding")
                else r[field].lower()
                for r in rows
            ]
            assert values == sorted(values, reverse=order == "desc")
    filtered = client.get(
        base
        + "/planned-entries?sort_by=expected_amount&sort_order=desc&query=Beta&state=open&direction=CREDIT"
    ).json()
    assert filtered["total"] == 80
    assert all(r["description"] == "Beta" for r in filtered["rows"])
    assert client.get(base + "/planned-entries?sort_by=unexpected").status_code == 422
    assert client.get(base + "/planned-entries?sort_order=unexpected").status_code == 422


def test_paid_outstanding_and_visible_status_order(statements):
    client, _, base, _ = statements
    credits = [r for r in imported(client, base) if r["direction"] == "CREDIT"]
    first, _ = new_plan(client, base, amount="100.00", description="Liquidado")
    second, _ = new_plan(client, base, amount="200.00", description="Parcial")
    new_plan(client, base, amount="300.00", description="Aberto")
    assert link(client, base, first[0], credits[0]).status_code == 200
    second = next(r for r in second if r["description"] == "Parcial")
    assert link(client, base, second, credits[1]).status_code == 200
    for field in ("paid", "outstanding", "state"):
        for order in ("asc", "desc"):
            rows = client.get(base + f"/planned-entries?sort_by={field}&sort_order={order}").json()[
                "rows"
            ]
            labels = {
                "open": "Em aberto",
                "partial": "Parcialmente realizado",
                "realized": "Realizado",
            }
            values = [labels[r["state"]] if field == "state" else Decimal(r[field]) for r in rows]
            assert values == sorted(values, reverse=order == "desc")
