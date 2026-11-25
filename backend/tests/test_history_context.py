from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app import assistant, recognition
from app.history_context import (
    complete_suggestion,
    confirmed,
    document_index,
    full_overview,
    related_evidence,
    reviewed_confidence,
)
from app.statements import actor


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def test_entire_base_supports_each_field_without_inventing_cost_center():
    party, category, sub, first, other = [str(uuid4()) for _ in range(5)]
    catalogs = {
        "parties": [{"id": party, "name": "Cliente Modelo", "tax_id": "00000000000191"}],
        "categories": [{"id": category, "name": "Recebimentos", "kind": "REVENUE"}],
        "subcategories": [{"id": sub, "name": "PIX faturado sintético", "category_id": category}],
        "cost_centers": [{"id": first, "name": "Centro A"}, {"id": other, "name": "Centro B"}],
    }
    docs = document_index(catalogs["parties"])
    base = {
        "account_id": "account-a",
        "direction": "CREDIT",
        "movement_kind": "NORMAL",
        "method": "OPERATOR",
        "party_id": None,
        "category_id": category,
        "subcategory_id": sub,
        "cost_center_id": first,
        "amount": "100.00",
        "posted_on": date(2025, 1, 1),
    }
    unrelated = [
        {
            **base,
            "raw_description": "PIX RECEBIDO OUTRO CLIENTE",
            "source_transaction_id": str(uuid4()),
        }
        for _ in range(200)
    ]
    related = [
        {
            **base,
            "raw_description": "PIX RECEBIDO Cliente Modelo Comercio",
            "source_transaction_id": str(uuid4()),
            "cost_center_id": first if i < 3 else other,
        }
        for i in range(5)
    ]
    history = unrelated + related
    target = {
        "id": str(uuid4()),
        "account_id": "account-a",
        "direction": "CREDIT",
        "raw_description": "PIX RECEBIDO 00000000000191",
    }
    facts, examples = related_evidence(confirmed(history), target, catalogs, docs)
    assert full_overview(history)["records_scanned"] == 205
    assert full_overview(history)["bank_credit"] == "20500.00"
    assert len(examples) == facts["matching_records"] == 5
    assert facts["fields"]["subcategory_id"]["unanimous"]
    assert not facts["fields"]["cost_center_id"]["unanimous"]
    suggestion = {
        "party_id": party,
        "movement_kind": "NORMAL",
        "category_id": None,
        "subcategory_id": None,
        "cost_center_id": None,
    }
    result = complete_suggestion(suggestion, facts, catalogs)
    assert result["category_id"] == category and result["subcategory_id"] == sub
    assert result["cost_center_id"] is None
    assert reviewed_confidence("HIGH", result, facts) == "MEDIUM"
    # Nem uma proposta completa deve esconder divergências do histórico.
    assert reviewed_confidence("HIGH", {**result, "cost_center_id": first}, facts) == "MEDIUM"
    # Uma nova decisão confirmada muda a análise; não há cache ou aprendizado circular.
    changed = {**related[0], "source_transaction_id": str(uuid4()), "subcategory_id": str(uuid4())}
    new_facts, _ = related_evidence(confirmed(history + [changed]), target, catalogs, docs)
    assert new_facts["matching_records"] == 6
    assert not new_facts["fields"]["subcategory_id"]["unanimous"]
    assert complete_suggestion(suggestion, new_facts, catalogs)["subcategory_id"] is None
    automatic = {**changed, "method": "PATTERN"}
    assert len(confirmed(history + [automatic])) == 205
    # Nomes que se sobrepõem a dois cadastros não são fundidos.
    catalogs["parties"].append({"id": str(uuid4()), "name": "Cliente Modelo Comercio"})
    ambiguous, _ = related_evidence(history, target, catalogs, docs)
    assert ambiguous["matching_records"] == 0


def test_targeted_recheck_appends_suggestions_without_confirming_bank_data(statements, monkeypatch):
    client, connection, base, _ = statements
    current = next(row for row in imported(client, base) if row["direction"] == "CREDIT")
    values = dimensions(client, base)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")

    def fake(context):
        assert context["historical_analysis"]["records_scanned"] == 4
        return [
            {
                **{key: values[key] for key in recognition.IDENT_FIELDS},
                "transaction_id": current["id"],
                "reason": "Exemplo sintético",
                "confidence": "HIGH",
            }
        ], "synthetic"

    monkeypatch.setattr(recognition, "generative_suggestions", fake)
    first = client.post(base + "/recognition/run", json={"transaction_id": current["id"]})
    assert first.status_code == 200, first.text
    second = client.post(base + "/recognition/run", json={"transaction_id": current["id"]})
    assert second.status_code == 200, second.text
    assert first.json()["automatic"] == second.json()["automatic"] == 0
    assert (
        first.json()["updated_suggestions"][0]["suggestion_id"]
        != second.json()["updated_suggestions"][0]["suggestion_id"]
    )
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_suggestions WHERE transaction_id=:id"),
            {"id": current["id"]},
        )
        == 2
    )
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_identifications WHERE transaction_id=:id"),
            {"id": current["id"]},
        )
        == 0
    )
    saved = client.put(base + "/transactions/" + current["id"] + "/identification", json=values)
    assert saved.status_code == 200
    assert (
        client.post(base + "/recognition/run", json={"transaction_id": current["id"]}).status_code
        == 409
    )


def test_chat_refreshes_entire_history_after_a_new_confirmation(statements, monkeypatch):
    client, _, base, _ = statements
    rows = imported(client, base)
    snapshots = []

    def fake(messages, context):
        snapshots.append(context["historical_analysis"])
        assert context["historical_analysis"]["records_scanned"] == 4
        return "Análise sintética sem alterações."

    monkeypatch.setattr(assistant, "generate_answer", fake)
    question = {"messages": [{"role": "user", "content": "Analise o histórico"}]}
    assert client.post(base + "/assistant/chat", json=question).status_code == 200
    current = next(row for row in rows if row["direction"] == "CREDIT")
    assert (
        client.put(
            base + "/transactions/" + current["id"] + "/identification",
            json=dimensions(client, base),
        ).status_code
        == 200
    )
    assert client.post(base + "/assistant/chat", json=question).status_code == 200
    assert snapshots[0]["confirmed_learning_records"] == 0
    assert snapshots[1]["confirmed_learning_records"] == 1


def test_recheck_completes_subclassification_from_sixteen_legacy_confirmations(
    statements, monkeypatch
):
    client, connection, base, _ = statements
    target = next(row for row in imported(client, base) if row["direction"] == "CREDIT")
    values = dimensions(client, base)
    sub = client.post(
        base + "/subcategories", json={"name": "PIX Faturado", "category_id": values["category_id"]}
    ).json()["id"]
    other = client.post(base + "/cost-centers", json={"name": "Outro centro sintético"}).json()[
        "id"
    ]
    user = actor(connection)
    for index in range(16):
        movement = connection.scalar(
            text("""
            INSERT INTO bank_transactions(account_id,import_file_id,source_row,posted_on,direction,
                amount,currency,raw_description,raw_payload,fingerprint)
            VALUES (:account,:file,:row,'2025-01-02','CREDIT',1,'BRL',
                'PIX RECEBIDO CLIENTE SINTETICO','{}'::jsonb,:fingerprint) RETURNING id
        """),
            {
                "account": target["account_id"],
                "file": target["import_file_id"],
                "row": 1000 + index,
                "fingerprint": "legacy-synthetic-" + str(index),
            },
        )
        connection.execute(
            text("""
            INSERT INTO transaction_identifications(transaction_id,organization_id,version,
                category_id,subcategory_id,cost_center_id,movement_kind,method,actor_id)
            VALUES (:tx,:org,1,:category,:sub,:center,'NORMAL','OPERATOR',:actor)
        """),
            {
                "tx": movement,
                "org": base.split("/")[2],
                "category": values["category_id"],
                "sub": sub,
                "center": values["cost_center_id"] if index < 14 else other,
                "actor": user,
            },
        )
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")

    def fake(context):
        facts = context["evidence_by_movement"][target["id"]]
        assert facts["matching_records"] == 16
        assert facts["fields"]["subcategory_id"]["values"] == {sub: 16}
        assert not facts["fields"]["cost_center_id"]["unanimous"]
        return [
            {
                "transaction_id": target["id"],
                "movement_kind": "NORMAL",
                "category_id": values["category_id"],
                "party_id": values["party_id"],
                "confidence": "HIGH",
                "reason": "Proposta incompleta sintética",
            }
        ], "synthetic"

    monkeypatch.setattr(recognition, "generative_suggestions", fake)
    response = client.post(base + "/recognition/run", json={"transaction_id": target["id"]})
    assert response.status_code == 200, response.text
    result = response.json()["updated_suggestions"][0]
    assert result["suggestion"]["subcategory_id"] == sub
    assert result["suggestion"]["cost_center_id"] is None
    assert result["confidence"] == "MEDIUM"
    assert "PIX Faturado (16/16)" in result["reason"]
