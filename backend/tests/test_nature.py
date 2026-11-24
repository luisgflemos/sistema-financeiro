import pytest
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app import recognition


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


@pytest.mark.parametrize(
    "direction,valid,invalid", [("CREDIT", "REVENUE", "EXPENSE"), ("DEBIT", "EXPENSE", "REVENUE")]
)
def test_normal_requires_category_matching_bank_direction(statements, direction, valid, invalid):
    client, _, base, _ = statements
    movement = next(row for row in imported(client, base) if row["direction"] == direction)
    wrong = dimensions(client, base, kind=invalid)
    correct = dimensions(client, base, kind=valid)
    endpoint = base + "/transactions/" + movement["id"] + "/identification"
    assert client.put(endpoint, json=wrong).status_code == 422
    assert client.put(endpoint, json=correct).status_code == 200


def test_internal_transfer_accepts_only_neutral_category_but_dimensions_are_optional(statements):
    client, _, base, _ = statements
    movements = imported(client, base)
    credit = next(row for row in movements if row["direction"] == "CREDIT")
    debit = next(row for row in movements if row["direction"] == "DEBIT")
    wrong = {**dimensions(client, base), "movement_kind": "INTERNAL_TRANSFER"}
    neutral = {**dimensions(client, base, kind="NEUTRAL"), "movement_kind": "INTERNAL_TRANSFER"}
    endpoint = base + "/transactions/" + credit["id"] + "/identification"
    assert client.put(endpoint, json=wrong).status_code == 422
    assert client.put(endpoint, json=neutral).status_code == 200
    assert (
        client.put(
            base + "/transactions/" + debit["id"] + "/identification",
            json={"movement_kind": "INTERNAL_TRANSFER"},
        ).status_code
        == 200
    )


def test_automatic_process_clears_residual_dimensions_and_preserves_original(statements):
    client, _, base, _ = statements
    movement = imported(client, base)[0]
    fields = dimensions(client, base)
    response = client.put(
        base + "/transactions/" + movement["id"] + "/identification",
        json={
            **fields,
            "movement_kind": "AUTOMATIC_PROCESS",
            "notes": "Aplicação automática sintética",
        },
    )
    assert response.status_code == 200, response.text
    row = next(
        row
        for row in client.get(base + "/transactions?state=all").json()["rows"]
        if row["id"] == movement["id"]
    )
    assert row["movement_kind"] == "AUTOMATIC_PROCESS"
    assert all(
        row[key] is None for key in ("party_id", "category_id", "subcategory_id", "cost_center_id")
    )
    assert (
        row["amount"] == movement["amount"]
        and row["raw_description"] == movement["raw_description"]
        and row["raw_payload"] == movement["raw_payload"]
    )
    assert row["notes"] == "Aplicação automática sintética"


def test_ai_rejects_wrong_nature_and_canonicalizes_automatic_suggestion(statements, monkeypatch):
    client, _, base, _ = statements
    rows = imported(client, base)
    credit = next(row for row in rows if row["direction"] == "CREDIT")
    debit = next(row for row in rows if row["direction"] == "DEBIT")
    fields = dimensions(client, base)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-test-placeholder")

    def fake(_context):
        return [
            {
                **fields,
                "transaction_id": debit["id"],
                "confidence": "HIGH",
                "reason": "Proposta incompatível",
            },
            {
                **fields,
                "transaction_id": credit["id"],
                "movement_kind": "AUTOMATIC_PROCESS",
                "confidence": "HIGH",
                "reason": "Processo automático proposto",
            },
        ], "synthetic-model"

    monkeypatch.setattr(recognition, "generative_suggestions", fake)
    response = client.post(base + "/recognition/run", json={})
    assert response.status_code == 200, response.text
    assert response.json()["suggestions"] == 1
    suggestion = client.get(base + "/transactions?state=suggested").json()["rows"][0]
    assert suggestion["id"] == credit["id"]
    assert all(
        suggestion["suggestion"][key] is None
        for key in ("party_id", "category_id", "subcategory_id", "cost_center_id")
    )
    assert client.get(base + "/transactions?state=identified").json()["total"] == 0


def test_planned_revenue_rejects_expense_category(statements):
    from uuid import uuid4

    client, _, base, _ = statements
    fields = dimensions(client, base, kind="EXPENSE")
    fields.pop("movement_kind")
    result = client.post(
        base + "/planned-entries",
        json={
            **fields,
            "request_key": str(uuid4()),
            "direction": "CREDIT",
            "description": "Previsão incompatível",
            "due_on": "2027-01-01",
            "expected_amount": "100.00",
        },
    )
    assert result.status_code == 422
    assert client.get(base + "/planned-entries").json()["total"] == 0
