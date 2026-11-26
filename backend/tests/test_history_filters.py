import pytest
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


@pytest.fixture
def identified(statements):
    client, connection, base, _ = statements
    credits = [row for row in imported(client, base) if row["direction"] == "CREDIT"]
    a = dimensions(client, base)
    b = dict(a)
    b["subcategory_id"] = client.post(
        base + "/subcategories",
        json={"name": "Outra sub sintética", "category_id": a["category_id"]},
    ).json()["id"]
    b["cost_center_id"] = client.post(
        base + "/cost-centers", json={"name": "Outro centro sintético"}
    ).json()["id"]
    b["party_id"] = client.post(
        base + "/parties",
        json={"display_name": "Outra contraparte sintética", "type": "BOTH"},
    ).json()["id"]
    c = dict(b)
    c["category_id"] = client.post(
        base + "/categories",
        json={"name": "Outra receita sintética", "kind": "REVENUE"},
    ).json()["id"]
    c["subcategory_id"] = client.post(
        base + "/subcategories",
        json={"name": "Sub de outra receita", "category_id": c["category_id"]},
    ).json()["id"]
    for row, values in zip(credits, [a, b, c], strict=True):
        response = client.put(base + f"/transactions/{row['id']}/identification", json=values)
        assert response.status_code == 200, response.text
    return client, connection, base, credits, a, b, c


@pytest.mark.parametrize(
    "field,which,total",
    [
        ("category_id", 0, 2),
        ("subcategory_id", 0, 1),
        ("party_id", 1, 2),
        ("cost_center_id", 1, 2),
    ],
)
def test_each_dimension_filters_latest_identification(identified, field, which, total):
    client, _, base, _, a, b, _ = identified
    value = [a, b][which][field]
    response = client.get(
        base + "/transactions",
        params={
            "state": "identified",
            field: value,
            "sort_by": "amount",
            "sort_order": "asc",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == total
    assert all(row[field] == value for row in data["rows"])
    selection = client.get(
        base + "/transactions",
        params={"state": "identified", field: value, "selection_only": True},
    ).json()
    assert set(selection["ids"]) == {row["id"] for row in data["rows"]}


def test_combined_filters_dates_search_and_latest_version(identified):
    client, connection, base, rows, a, b, _ = identified
    params = {
        key: b[key] for key in ("category_id", "subcategory_id", "party_id", "cost_center_id")
    }
    params.update(
        state="identified",
        account_id=rows[1]["account_id"],
        direction="CREDIT",
        start="2026-01-02",
        end="2026-01-02",
        query="SINTETICO",
    )
    data = client.get(base + "/transactions", params=params).json()
    assert data["total"] == 1 and data["rows"][0]["id"] == rows[1]["id"]
    changed = client.put(
        base + f"/transactions/{rows[0]['id']}/identification",
        json={**a, "cost_center_id": b["cost_center_id"], "expected_version": 1},
    )
    assert changed.status_code == 200
    assert (
        client.get(
            base + "/transactions",
            params={"state": "identified", "cost_center_id": a["cost_center_id"]},
        ).json()["total"]
        == 0
    )
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_identifications WHERE transaction_id=:id"),
            {"id": rows[0]["id"]},
        )
        == 2
    )


def test_inactive_catalog_filters_history_without_leaking_other_organizations(
    identified,
):
    client, _, base, _, a, _, _ = identified
    assert client.delete(base + "/parties/" + a["party_id"]).status_code == 204
    assert (
        client.get(
            base + "/transactions",
            params={"state": "identified", "party_id": a["party_id"]},
        ).json()["total"]
        == 1
    )
    other = client.post("/organizations", json={"name": "Outra organização sintética"}).json()["id"]
    assert (
        client.get(
            f"/organizations/{other}/transactions",
            params={"state": "all", "party_id": a["party_id"]},
        ).json()["total"]
        == 0
    )
    for field in ("category_id", "subcategory_id", "party_id", "cost_center_id"):
        assert client.get(base + "/transactions", params={field: "invalid"}).status_code == 422


def test_filter_counts_cover_all_pages(identified):
    client, connection, base, rows, a, _, _ = identified
    connection.execute(
        text("""
        WITH added AS (
            INSERT INTO bank_transactions(account_id,import_file_id,source_row,posted_on,direction,amount,currency,raw_description,raw_payload,fingerprint)
            SELECT t.account_id,t.import_file_id,n,'2026-01-02','CREDIT',1,'BRL','Recebimento sintético paginado','{}'::jsonb,'history-filter-'||n
            FROM bank_transactions t CROSS JOIN generate_series(1000,1104) n WHERE t.id=:id RETURNING id
        ) INSERT INTO transaction_identifications(transaction_id,organization_id,version,category_id,subcategory_id,cost_center_id,party_id,movement_kind,method,actor_id)
        SELECT added.id,i.organization_id,1,i.category_id,i.subcategory_id,i.cost_center_id,i.party_id,'NORMAL','OPERATOR',i.actor_id
        FROM added CROSS JOIN transaction_identifications i WHERE i.transaction_id=:id AND i.version=1
    """),
        {"id": rows[0]["id"]},
    )
    params = {
        "state": "identified",
        "subcategory_id": a["subcategory_id"],
        "sort_by": "amount",
        "sort_order": "asc",
    }
    first = client.get(base + "/transactions", params=params).json()
    second = client.get(base + "/transactions", params={**params, "page": 2}).json()
    assert first["total"] == second["total"] == 106
    assert len(first["rows"]) == 100 and len(second["rows"]) == 6
    assert len({row["id"] for row in first["rows"] + second["rows"]}) == 106
