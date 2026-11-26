"""Regressões sintéticas: descrição explícita sem cliente e omissões generativas."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app import recognition
from app.history_context import (
    complete_suggestion,
    description_key,
    field_confidences,
    related_evidence,
    reviewed_confidence,
)
from app.statements import actor


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def examples(description="PAGAMENTO CARTAO DE DEBITO ADQUIRENTE-BANDEIRA", direction="CREDIT"):
    category, sub, center, other = [str(uuid4()) for _ in range(4)]
    catalogs = {
        "parties": [],
        "customer_groups": [],
        "categories": [
            {
                "id": category,
                "name": "Categoria sintética",
                "kind": "REVENUE" if direction == "CREDIT" else "EXPENSE",
            }
        ],
        "subcategories": [{"id": sub, "name": "Sub sintética", "category_id": category}],
        "cost_centers": [{"id": center, "name": "Centro A"}, {"id": other, "name": "Centro B"}],
    }
    target = {
        "id": str(uuid4()),
        "account_id": "account-a",
        "direction": direction,
        "raw_description": description,
    }
    rows = [
        {
            **target,
            "source_transaction_id": str(uuid4()),
            "movement_kind": "NORMAL",
            "party_id": None,
            "category_id": category,
            "subcategory_id": sub,
            "cost_center_id": center,
        }
        for _ in range(5)
    ]
    return catalogs, target, rows, category, sub, center, other


@pytest.mark.parametrize(
    "direction,description",
    [
        ("CREDIT", "PAGAMENTO CARTAO DE DEBITO ADQUIRENTE-BANDEIRA"),
        ("DEBIT", "PIX ENVIADO ANUNCIANTE SINTETICO ONLINE"),
        ("CREDIT", "PIX RECEBIDO 00000000000191"),
    ],
)
def test_description_suggests_dimensions_without_customer(direction, description):
    catalogs, target, rows, category, sub, center, _ = examples(description, direction)
    facts, related = related_evidence(rows, target, catalogs, {})
    assert len(related) == 5
    item = complete_suggestion({"movement_kind": "NORMAL"}, facts, catalogs)
    assert (item["category_id"], item["subcategory_id"], item["cost_center_id"]) == (
        category,
        sub,
        center,
    )
    assert not item.get("party_id") and not item.get("customer_group_id")
    assert reviewed_confidence("HIGH", item, facts) == "HIGH"


def test_center_conflicts_do_not_block_category_or_subcategory():
    catalogs, target, rows, category, sub, center, other = examples()
    rows[-1]["cost_center_id"] = other
    facts, _ = related_evidence(rows, target, catalogs, {})
    item = complete_suggestion({"movement_kind": "NORMAL"}, facts, catalogs)
    assert item["subcategory_id"] == sub and item["category_id"] == category
    assert item["cost_center_id"] == center
    assert field_confidences(item, facts, "MEDIUM")["cost_center_id"] == "MEDIUM"
    facts, _ = related_evidence([rows[0], rows[-1]], target, catalogs, {})
    assert not complete_suggestion({"movement_kind": "NORMAL"}, facts, catalogs).get(
        "cost_center_id"
    )


def test_different_payers_and_opposite_directions_are_not_collapsed():
    catalogs, target, rows, *_ = examples("PIX RECEBIDO 00000000000191")
    rows[0]["raw_description"] = "PIX RECEBIDO 00000000000272"
    rows[1]["direction"] = "DEBIT"
    rows[2]["account_id"] = "account-b"
    facts, _ = related_evidence(rows, target, catalogs, {})
    assert facts["matching_records"] == 2
    assert description_key("PIX RECEBIDO 00000000000191") != description_key(
        "PIX RECEBIDO 00000000000272"
    )


def test_collection_references_do_not_hide_same_bank_operation():
    catalogs, target, rows, *_ = examples("CR COB BLOQ COMP CONF RECEBIMENTO 0001/123456")
    for index, row in enumerate(rows):
        row["raw_description"] = f"CR COB BLOQ COMP CONF RECEBIMENTO 0001/{700000 + index}"
    facts, _ = related_evidence(rows, target, catalogs, {})
    assert facts["matching_records"] == 5


@pytest.mark.parametrize("provider", ["omits", "fails", "invalid", "disabled"])
def test_every_known_description_gets_suggestion_without_auto_approval(
    statements, monkeypatch, provider
):
    client, connection, base, _ = statements
    target = next(row for row in imported(client, base) if row["direction"] == "DEBIT")
    values = dimensions(client, base, "EXPENSE")
    values["party_id"] = None
    user = actor(connection)
    # Registros brutos e decisões exclusivamente sintéticos.
    for index in range(4):
        tx = connection.scalar(
            text("""
            INSERT INTO bank_transactions(account_id,import_file_id,source_row,posted_on,direction,
                amount,currency,raw_description,raw_payload,fingerprint)
            VALUES (:account,:file,:row,'2025-01-02','DEBIT',1,'BRL',:description,'{}'::jsonb,:fingerprint) RETURNING id
        """),
            {
                "account": target["account_id"],
                "file": target["import_file_id"],
                "row": 1000 + index,
                "description": target["raw_description"],
                "fingerprint": f"coverage-synthetic-{index}",
            },
        )
        connection.execute(
            text("""
            INSERT INTO transaction_identifications(transaction_id,organization_id,version,
                category_id,subcategory_id,cost_center_id,movement_kind,method,actor_id)
            VALUES (:tx,:org,1,:category,:sub,:center,'NORMAL','OPERATOR',:actor)
        """),
            {
                "tx": tx,
                "org": base.split("/")[2],
                "category": values["category_id"],
                "sub": values["subcategory_id"],
                "center": values["cost_center_id"],
                "actor": user,
            },
        )
    if provider == "disabled":
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    else:
        monkeypatch.setenv("OPENAI_API_KEY", "synthetic-test-placeholder")

    def fake(_context):
        if provider == "fails":
            raise HTTPException(502, "Falha sintética da IA")
        if provider == "invalid":
            return [
                {
                    "transaction_id": target["id"],
                    "movement_kind": "NORMAL",
                    "party_id": str(uuid4()),
                    "reason": "Sintético",
                    "confidence": "HIGH",
                }
            ], "synthetic"
        return [], "synthetic"

    monkeypatch.setattr(recognition, "generative_suggestions", fake)
    response = client.post(base + "/recognition/run", json={"transaction_id": target["id"]})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["automatic"] == 0 and result["suggestions"] == 1
    suggestion = result["updated_suggestions"][0]["suggestion"]
    for field in ("category_id", "subcategory_id", "cost_center_id"):
        assert suggestion[field] == values[field]
    assert suggestion["party_id"] is None
    assert (
        connection.scalar(
            text("SELECT count(*) FROM transaction_identifications WHERE transaction_id=:id"),
            {"id": target["id"]},
        )
        == 0
    )
