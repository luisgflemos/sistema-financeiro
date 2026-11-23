import pytest
from sqlalchemy import text
from test_statements import source
from test_statements import statements as statement_fixture  # noqa: F401

from app import recognition


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def imported(client, base):
    payload = {"files": [source()]}
    preview = client.post(base + "/statements/preview", json=payload).json()
    response = client.post(base + "/statements/commit", json={**payload, "token": preview["token"]})
    assert response.status_code == 200, response.text
    return client.get(base + "/transactions").json()["rows"]


def dimensions(client, base):
    party = client.post(
        base + "/parties",
        json={"display_name": "Cliente sintético", "type": "CUSTOMER"},
    ).json()
    category = client.post(
        base + "/categories", json={"name": "Receita sintética", "kind": "REVENUE"}
    ).json()
    sub = client.post(
        base + "/subcategories",
        json={"name": "Sub sintética", "category_id": category["id"]},
    ).json()
    center = client.post(base + "/cost-centers", json={"name": "Centro sintético"}).json()
    return {
        "party_id": party["id"],
        "category_id": category["id"],
        "subcategory_id": sub["id"],
        "cost_center_id": center["id"],
        "movement_kind": "NORMAL",
    }


def test_identification_is_versioned_and_bank_movement_is_unchanged(statements):
    client, connection, base, _ = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    endpoint = base + "/transactions/" + rows[0]["id"] + "/identification"
    assert client.put(endpoint, json=values).status_code == 200
    assert client.put(endpoint, json=values).status_code == 409
    assert (
        client.put(
            endpoint,
            json={**values, "expected_version": 1, "notes": "Revisão sintética"},
        ).status_code
        == 200
    )
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_identifications WHERE organization_id=:org"),
            {"org": base.split("/")[2]},
        )
        == 2
    )
    assert client.get(base + "/transactions?state=identified").json()["total"] == 1
    assert client.get(base + "/transactions").json()["total"] == 3
    stored = connection.execute(
        text("SELECT amount, raw_description FROM bank_transactions WHERE id=:id"),
        {"id": rows[0]["id"]},
    ).one()
    assert str(stored.amount) == rows[0]["amount"]
    assert stored.raw_description == rows[0]["raw_description"]


def test_identification_rejects_cross_organization_and_wrong_subcategory(statements):
    client, _, base, _ = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    other = client.post("/organizations", json={"name": "Outra organização sintética"}).json()["id"]
    foreign = client.post(
        f"/organizations/{other}/parties",
        json={"display_name": "Outro", "type": "CUSTOMER"},
    ).json()
    endpoint = base + "/transactions/" + rows[0]["id"] + "/identification"
    assert client.put(endpoint, json={**values, "party_id": foreign["id"]}).status_code == 422
    assert client.get(f"/organizations/{other}/transactions").json()["total"] == 0
    assert (
        client.put(
            f"/organizations/{other}/transactions/" + rows[0]["id"] + "/identification",
            json=values,
        ).status_code
        == 404
    )


def test_generative_suggestions_need_confirmation_and_reject_unknown_ids(statements, monkeypatch):
    client, connection, base, _ = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-test-placeholder")

    def fake(context):
        assert context["confirmed_examples"] == []
        assert len(context["movements"]) == 4
        return [
            {
                "transaction_id": rows[0]["id"],
                **values,
                "reason": "Exemplo sintético",
                "confidence": "HIGH",
            },
            {
                "transaction_id": "00000000-0000-0000-0000-000000000000",
                **values,
                "reason": "Inválido",
                "confidence": "HIGH",
            },
        ], "test-model"

    monkeypatch.setattr(recognition, "generative_suggestions", fake)
    result = client.post(base + "/recognition/run", json={})
    assert result.status_code == 200, result.text
    assert result.json()["suggestions"] == 1
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_identifications WHERE organization_id=:org"),
            {"org": base.split("/")[2]},
        )
        == 0
    )
    suggestion = client.get(base + "/transactions?state=suggested").json()["rows"][0]
    assert (
        client.put(
            base + "/transactions/" + rows[0]["id"] + "/identification",
            json={**values, "suggestion_id": suggestion["suggestion_id"]},
        ).status_code
        == 200
    )
    assert (
        connection.scalar(
            text("SELECT method FROM transaction_identifications WHERE organization_id=:org"),
            {"org": base.split("/")[2]},
        )
        == "AI_CONFIRMED"
    )


def test_pattern_uses_only_consistent_operator_confirmations(statements, monkeypatch):
    client, connection, base, _ = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    credits = [row for row in rows if row["direction"] == "CREDIT"]
    for row in credits:
        assert (
            client.put(
                base + "/transactions/" + row["id"] + "/identification", json=values
            ).status_code
            == 200
        )
    # Outro arquivo com mais uma ocorrência, explicitamente confirmada como nova.
    next_source = source(single=True)
    next_source["decisions"] = {"4": "new"}
    preview = client.post(base + "/statements/preview", json={"files": [next_source]}).json()
    response = client.post(
        base + "/statements/commit",
        json={"files": [next_source], "token": preview["token"]},
    )
    assert response.status_code == 200, response.text
    result = client.post(base + "/recognition/run", json={}).json()
    assert result["automatic"] == 1
    assert (
        connection.scalar(
            text(
                "SELECT count(*) FROM transaction_identifications WHERE method='PATTERN' AND organization_id=:org"
            ),
            {"org": base.split("/")[2]},
        )
        == 1
    )


def test_partial_ai_suggestion_does_not_bypass_required_identification(statements, monkeypatch):
    client, _, base, _ = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-test-placeholder")

    def fake(_context):
        return [
            {
                "transaction_id": rows[0]["id"],
                "party_id": values["party_id"],
                "category_id": None,
                "subcategory_id": None,
                "cost_center_id": None,
                "movement_kind": "NORMAL",
                "reason": "Somente a contraparte foi identificada.",
                "confidence": "MEDIUM",
            }
        ], "test-model"

    monkeypatch.setattr(recognition, "generative_suggestions", fake)
    response = client.post(base + "/recognition/run", json={})
    assert response.json()["suggestions"] == 1
    suggestion = client.get(base + "/transactions?state=suggested").json()["rows"][0]
    incomplete = {**suggestion["suggestion"], "suggestion_id": suggestion["suggestion_id"]}
    assert (
        client.put(
            base + "/transactions/" + rows[0]["id"] + "/identification", json=incomplete
        ).status_code
        == 422
    )


def test_party_is_optional_and_complementary_description_is_preserved(statements):
    client, _, base, _ = statements
    row = imported(client, base)[0]
    values = dimensions(client, base)
    values["party_id"] = None
    values["notes"] = "Descrição complementar sintética."
    response = client.put(base + "/transactions/" + row["id"] + "/identification", json=values)
    assert response.status_code == 200, response.text
    result = client.get(base + "/transactions?state=identified").json()["rows"][0]
    assert result["party_id"] is None
    assert result["notes"] == values["notes"]
    assert result["raw_description"] == row["raw_description"]
