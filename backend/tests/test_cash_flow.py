import base64
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions

from app.cash_forecast import distribute, learn, project


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def historical(direction="DEBIT", amounts=None, weekdays=False):
    rows = []
    for index in range(6):
        day = date(2026, index + 1, 15)
        if weekdays:
            dates = [
                date(2026, index + 1, d)
                for d in range(1, 29)
                if date(2026, index + 1, d).weekday() < 5
            ]
        else:
            dates = [day]
        for due in dates:
            rows.append(
                {
                    "account_id": "a",
                    "direction": direction,
                    "category_id": "c",
                    "subcategory_id": "s",
                    "cost_center_id": "cc",
                    "posted_on": due,
                    "amount": Decimal(amounts[index] if amounts else "500.00"),
                    "method": "OPERATOR",
                    "movement_kind": "NORMAL",
                }
            )
    return rows


def test_projects_without_any_future_entries_and_keeps_exact_cents():
    rows = historical()
    patterns = learn(rows, date(2026, 7, 1), {"a": date(2026, 1, 1)})
    assert len(patterns) == 1 and patterns[0]["confidence"] == "high"
    budgets, items = project(patterns, rows, [], date(2026, 7, 1), date(2026, 8, 31), {})
    assert [(i["date"], i["amount"]) for i in items] == [
        (date(2026, 7, 15), Decimal(500)),
        (date(2026, 8, 15), Decimal(500)),
    ]
    assert all(b["target"] == Decimal(500) for b in budgets)
    days = [date(2026, 7, 1) + timedelta(days=i) for i in range(7)]
    parts = distribute(Decimal("100.01"), days, [Decimal(1)] * 7)
    assert sum(v for _, v in parts) == Decimal("100.01")
    assert all(v == v.quantize(Decimal(".01")) for _, v in parts)


def test_pending_neutral_stale_and_future_records_do_not_train():
    rows = historical()
    for changes in (
        {"method": None},
        {"movement_kind": "INTERNAL_TRANSFER"},
        {"movement_kind": "AUTOMATIC_PROCESS"},
        {"method": "PATTERN"},
    ):
        assert (
            learn([{**r, **changes} for r in rows], date(2026, 7, 1), {"a": date(2026, 1, 1)}) == []
        )
    assert learn(rows, date(2026, 11, 1), {"a": date(2026, 1, 1)}) == []
    assert (
        learn(
            [{**r, "posted_on": date(2027, 1, 1)} for r in rows],
            date(2026, 7, 1),
            {"a": date(2026, 1, 1)},
        )
        == []
    )


def test_registered_and_realized_cover_forecast_once_including_blank_account():
    rows = historical() + [
        {**historical()[0], "posted_on": date(2026, 7, 1), "amount": Decimal(100)}
    ]
    patterns = learn(rows, date(2026, 7, 1), {"a": date(2026, 1, 1)})
    entry = {
        "id": "e",
        "due_on": date(2026, 7, 15),
        "outstanding": "200.00",
        "direction": "DEBIT",
        "category_id": "c",
        "subcategory_id": "s",
        "account_id": None,
        "cost_center_id": None,
    }
    budgets, items = project(patterns, rows, [entry], date(2026, 7, 1), date(2026, 7, 31), {})
    assert budgets[0]["actual"] == 100 and budgets[0]["registered"] == 200
    assert sum(i["amount"] for i in items) == 200
    other = {
        **patterns[0],
        "key": "other",
        "dimensions": {**patterns[0]["dimensions"], "account_id": "b"},
    }
    budgets, _ = project([*patterns, other], rows, [entry], date(2026, 7, 1), date(2026, 7, 31), {})
    assert sum(b["registered"] for b in budgets) == 200


def test_weekday_timing_trend_seasonality_and_decisions_are_explained():
    rows = historical("CREDIT", weekdays=True)
    patterns = learn(rows, date(2026, 7, 1), {"a": date(2026, 1, 1)})
    budgets, items = project(patterns, rows, [], date(2026, 7, 1), date(2026, 7, 31), {})
    assert items and all(i["date"].weekday() < 5 for i in items)
    assert sum(i["amount"] for i in items) == budgets[0]["remaining"]
    key = patterns[0]["key"]
    _, excluded = project(
        patterns,
        rows,
        [],
        date(2026, 7, 1),
        date(2026, 7, 31),
        {(key, date(2026, 7, 1)): {"action": "EXCLUDE", "amount": None}},
    )
    assert not excluded
    _, changed = project(
        patterns,
        rows,
        [],
        date(2026, 7, 1),
        date(2026, 7, 31),
        {(key, date(2026, 7, 1)): {"action": "ADJUST", "amount": Decimal("123.45")}},
    )
    assert sum(i["amount"] for i in changed) == Decimal("123.45")
    growing = learn(
        historical(amounts=["100", "100", "100", "200", "200", "200"]),
        date(2026, 7, 1),
        {"a": date(2026, 1, 1)},
    )[0]
    assert Decimal(1) < growing["trend"] <= Decimal("1.15")
    seasonal = {
        **patterns[0],
        "annual": {7: [Decimal(200), Decimal(200)], 8: [Decimal(100), Decimal(100)]},
    }
    result, _ = project([seasonal], rows, [], date(2026, 7, 1), date(2026, 7, 31), {})
    assert result[0]["seasonal"] > 1


@pytest.fixture
def flow_data(statements):
    client, connection, base, accounts = statements
    dims = dimensions(client, base, "EXPENSE")
    csv = "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n"
    for m in range(6, 0, -1):
        csv += f"15/{m:02d}/2026;AGUA SINTETICA;{m};-500;{10000 - m * 500}\n"
    files = [
        {"file_name": "agua-sintetica.csv", "content": base64.b64encode(csv.encode()).decode()}
    ]
    preview = client.post(base + "/statements/preview", json={"files": files})
    assert preview.status_code == 200, preview.text
    saved = client.post(
        base + "/statements/commit", json={"files": files, "token": preview.json()["token"]}
    )
    assert saved.status_code == 200, saved.text
    for row in client.get(base + "/transactions").json()["rows"]:
        assert (
            client.put(
                base + "/transactions/" + row["id"] + "/identification", json=dims
            ).status_code
            == 200
        )
    filters = {
        "as_of": "2026-07-01",
        "start": "2026-06-01",
        "end": "2026-08-31",
        "account_id": accounts[0],
    }
    return client, connection, base, accounts, dims, filters


def test_report_uses_bank_anchor_and_no_planned_rows_still_predicts(flow_data):
    client, _, base, accounts, _, filters = flow_data
    result = client.get(base + "/cash-flow", params=filters)
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["anchor"] == "7000.00"
    assert data["totals"]["forecast_debit"] == "1000.00"
    assert data["closing"] == "6000.00"
    assert data["totals"]["realized_debit"] == "500.00"
    assert data["history_scanned"] == 6 and data["training_records"] == 6
    future = client.get(base + "/cash-flow", params={**filters, "start": "2026-08-01"}).json()
    assert future["closing"] == data["closing"]
    center = data["catalogs"]["cost_centers"][0]["id"]
    assert (
        client.get(base + "/cash-flow", params={**filters, "cost_center_id": center}).json()[
            "anchor"
        ]
        is None
    )
    other = client.post("/organizations", json={"name": "Outra organização"}).json()["id"]
    assert client.get(f"/organizations/{other}/cash-flow", params=filters).status_code == 422
    assert (
        client.get(base + "/cash-flow", params={**filters, "as_of": "2099-01-01"}).status_code
        == 422
    )
    assert (
        client.get(base + "/cash-flow", params={**filters, "end": "2028-01-01"}).status_code == 422
    )
    consolidated = client.get(
        base + "/cash-flow", params={k: v for k, v in filters.items() if k != "account_id"}
    ).json()
    assert consolidated["known_accounts"] == 1 and consolidated["total_accounts"] == len(accounts)


def test_decisions_audit_idempotency_stale_and_reset(flow_data):
    client, connection, base, _, _, filters = flow_data
    p = client.get(base + "/cash-flow", params=filters).json()["patterns"][0]
    payload = {
        "filters": filters,
        "key": p["key"],
        "period": p["period"],
        "expected_revision": p["revision"],
        "action": "ADJUST",
        "amount": "600.00",
        "reason": "Revisão sintética do orçamento",
        "request_key": str(uuid4()),
    }
    result = client.post(base + "/cash-flow/decisions", json=payload)
    assert result.status_code == 201, result.text
    assert client.post(base + "/cash-flow/decisions", json=payload).json()["repeated"]
    assert (
        client.post(base + "/cash-flow/decisions", json={**payload, "amount": "700.00"}).status_code
        == 409
    )
    assert (
        client.post(
            base + "/cash-flow/decisions", json={**payload, "request_key": str(uuid4())}
        ).status_code
        == 409
    )
    report = client.get(base + "/cash-flow", params=filters).json()
    changed = report["patterns"][0]
    assert changed["target"] == "600.00" and changed["manual"]
    assert report["anchor"] == "7000.00"
    assert (
        client.post(
            base + "/cash-flow/decisions",
            json={
                **payload,
                "action": "RESET",
                "amount": None,
                "expected_revision": changed["revision"],
                "request_key": str(uuid4()),
            },
        ).status_code
        == 201
    )
    assert (
        client.get(base + "/cash-flow", params=filters).json()["patterns"][0]["target"] == "500.00"
    )
    assert (
        connection.scalar(
            text(
                "SELECT count(*) FROM audit_events WHERE entity_type='cash_projection_decisions' AND entity_id=:id"
            ),
            {"id": result.json()["id"]},
        )
        == 1
    )


def test_convert_recurring_and_recalculation_never_doubles_count(flow_data):
    client, _, base, _, _, filters = flow_data
    p = client.get(base + "/cash-flow", params=filters).json()["patterns"][0]
    payload = {
        "filters": filters,
        "key": p["key"],
        "period": p["period"],
        "expected_revision": p["revision"],
        "due_on": "2026-07-15",
        "amount": "500.00",
        "frequency": "MONTHLY",
        "occurrences": 2,
        "request_key": str(uuid4()),
    }
    created = client.post(base + "/cash-flow/convert", json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["created"] == 2
    assert client.post(base + "/cash-flow/convert", json=payload).json()["repeated"]
    result = client.get(base + "/cash-flow", params=filters).json()
    assert result["totals"]["registered_debit"] == "1000.00"
    assert result["totals"]["forecast_debit"] == "0.00"
    assert result["closing"] == "6000.00"
    assert client.get(base + "/planned-entries").json()["total"] == 2


def test_overdue_is_not_silently_shifted_to_tomorrow(flow_data):
    client, _, base, accounts, dims, filters = flow_data
    entry = {k: v for k, v in dims.items() if k != "movement_kind"}
    made = client.post(
        base + "/planned-entries",
        json={
            **entry,
            "description": "Título atrasado sintético",
            "due_on": "2026-06-20",
            "direction": "DEBIT",
            "expected_amount": "100.00",
            "account_id": accounts[0],
            "request_key": str(uuid4()),
        },
    )
    assert made.status_code == 201, made.text
    result = client.get(base + "/cash-flow", params=filters).json()
    assert len(result["overdue"]) == 1
    assert result["totals"]["registered_debit"] == "0.00"
    assert result["closing"] == "6000.00"


def test_fin_receives_calculated_cash_flow_not_invented_predictions(flow_data, monkeypatch):
    from app import assistant

    client, _, base, _, _, filters = flow_data
    captured = {}

    def answer(messages, context):
        captured.update(context)
        return "Projeção sintética sustentada no histórico."

    monkeypatch.setattr(assistant, "generate_answer", answer)
    response = client.post(
        base + "/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Explique o fluxo"}],
            "screen": "Fluxo de Caixa",
            "cash_flow": filters,
        },
    )
    assert response.status_code == 200, response.text
    flow = captured["cash_flow"]
    assert flow["history_scanned"] == 6
    assert flow["totals"]["forecast_debit"] == Decimal("1000.00")
    assert flow["patterns"][0]["subcategory_name"] == "Sub sintética"
    assert "category_id" not in flow["patterns"][0]


def test_unassigned_commitment_covers_only_consolidated_forecast(flow_data):
    client, _, base, _, dims, filters = flow_data
    fields = {k: v for k, v in dims.items() if k != "movement_kind"}
    created = client.post(
        base + "/planned-entries",
        json={
            **fields,
            "description": "Compromisso sem conta",
            "due_on": "2026-07-15",
            "direction": "DEBIT",
            "expected_amount": "500.00",
            "request_key": str(uuid4()),
        },
    )
    assert created.status_code == 201, created.text
    per_account = client.get(base + "/cash-flow", params=filters).json()
    assert per_account["totals"]["registered_debit"] == "0.00"
    assert per_account["totals"]["forecast_debit"] == "1000.00"
    all_accounts = client.get(
        base + "/cash-flow", params={k: v for k, v in filters.items() if k != "account_id"}
    ).json()
    assert all_accounts["totals"]["registered_debit"] == "500.00"
    assert all_accounts["totals"]["forecast_debit"] == "500.00"
    assert all_accounts["closing"] == "6000.00"


def test_neutral_realized_moves_bank_balance_without_becoming_expense(flow_data):
    client, _, base, _, _, filters = flow_data
    rows = client.get(base + "/transactions", params={"state": "all"}).json()["rows"]
    june = next(r for r in rows if r["posted_on"] == "2026-06-15")
    updated = client.put(
        base + "/transactions/" + june["id"] + "/identification",
        json={"movement_kind": "INTERNAL_TRANSFER", "expected_version": 1},
    )
    assert updated.status_code == 200, updated.text
    result = client.get(base + "/cash-flow", params=filters).json()
    assert result["anchor"] == "7000.00"
    assert result["totals"]["realized_debit"] == "0.00"
    assert result["totals"]["neutral_net"] == "-500.00"
    assert next(r for r in result["daily"] if r["date"] == "2026-06-15")["balance"] == "7000.00"
    assert result["training_records"] == 5
