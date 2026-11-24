from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text
from test_historical_import import catalogs, upload
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


@pytest.mark.parametrize("field", ["date", "account", "description", "amount"])
def test_ordering_covers_all_pages_and_preserves_filters(statements, field):
    client, _, base, accounts = statements
    catalogs(client, base)
    source = []
    for index in range(205):
        credit = index % 2 == 0
        source.append(
            [
                "Conta A" if index % 3 == 0 else "Conta B",
                datetime(2025, 1, 1) + timedelta(days=index),
                f"MOVIMENTO {205 - index:03}",
                None,
                index + 1 if credit else None,
                None if credit else -(index + 1),
                "Recebimento" if credit else "Despesas Gerais",
                "PIX à Vista" if credit else "Fornecedor",
                "L",
                None,
                "Centro sintético",
            ]
        )
    payload = upload(rows=source)
    preview = client.post(base + "/historical-import/preview", json=payload).json()
    response = client.post(
        base + "/historical-import/commit", json={**payload, "token": preview["token"]}
    )
    assert response.status_code == 200, response.text
    for order in ("asc", "desc"):
        rows = []
        for page in (1, 2, 3):
            result = client.get(
                base + f"/transactions?state=all&sort_by={field}&sort_order={order}&page={page}"
            ).json()
            assert result["total"] == 205
            rows.extend(result["rows"])
        assert len({row["id"] for row in rows}) == 205

        def key(row):
            return {
                "date": row["posted_on"],
                "account": row["account_label"].lower(),
                "description": row["raw_description"].lower(),
                "amount": Decimal(row["amount"]) * (-1 if row["direction"] == "DEBIT" else 1),
            }[field]

        values = [key(row) for row in rows]
        assert values == sorted(values, reverse=order == "desc")
        filtered = client.get(
            base
            + f"/transactions?state=identified&sort_by={field}&sort_order={order}&account_id={accounts[1]}&direction=DEBIT"
        ).json()
        assert filtered["total"] > 0
        assert all(
            r["account_id"] == accounts[1] and r["direction"] == "DEBIT" for r in filtered["rows"]
        )
    assert (
        client.get(
            base + "/transactions?sort_by=amount;DROP%20TABLE%20bank_transactions"
        ).status_code
        == 422
    )
    assert client.get(base + "/transactions?sort_order=invalid").status_code == 422


def test_identification_sort_matches_visible_labels_and_statement_view(statements):
    client, connection, base, _ = statements
    rows = imported(client, base)
    credits = [r for r in rows if r["direction"] == "CREDIT"]
    fields = dimensions(client, base)
    assert (
        client.put(
            base + "/transactions/" + credits[0]["id"] + "/identification", json=fields
        ).status_code
        == 200
    )
    assert (
        client.put(
            base + "/transactions/" + credits[1]["id"] + "/identification",
            json={"movement_kind": "AUTOMATIC_PROCESS"},
        ).status_code
        == 200
    )
    assert (
        client.put(
            base + "/transactions/" + credits[2]["id"] + "/identification",
            json={"movement_kind": "INTERNAL_TRANSFER"},
        ).status_code
        == 200
    )
    debit = next(r for r in rows if r["direction"] == "DEBIT")
    connection.execute(
        text(
            "INSERT INTO transaction_suggestions(transaction_id,organization_id,payload,reason,confidence,model) VALUES (:tx,:org,'{}','Sintético','LOW','test')"
        ),
        {"tx": debit["id"], "org": base.split("/")[2]},
    )
    expected = [credits[0]["id"], credits[1]["id"], debit["id"], credits[2]["id"]]
    for order in ("asc", "desc"):
        actual = client.get(
            base + f"/transactions?state=all&sort_by=identification&sort_order={order}"
        ).json()["rows"]
        assert [r["id"] for r in actual] == (expected if order == "asc" else expected[::-1])
        view = client.get(
            base
            + f"/transactions?state=all&sort_by=amount&sort_order={order}&statement_id="
            + rows[0]["import_file_id"]
        ).json()
        amounts = [
            Decimal(r["amount"]) * (-1 if r["direction"] == "DEBIT" else 1) for r in view["rows"]
        ]
        assert amounts == sorted(amounts, reverse=order == "desc")
