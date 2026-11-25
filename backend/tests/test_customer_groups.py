import base64
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app.customer_identity import prioritize_customer, resolve_customer
from app.history_context import complete_suggestion, related_evidence


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def customer(client, base, name):
    return client.post(base + "/parties", json={"display_name": name, "type": "CUSTOMER"}).json()


def test_group_membership_is_simple_scoped_audited_and_preserves_clients(statements):
    client, conn, base, _ = statements
    a = customer(client, base, "Cliente específico A")
    b = customer(client, base, "Cliente específico B")
    made = client.post(
        base + "/customer-groups",
        json={"name": "Grupo sintético", "member_ids": [a["id"], b["id"]]},
    )
    assert made.status_code == 201, made.text
    group = made.json()
    assert group["code"].startswith("GRP-") and set(group["member_ids"]) == {
        a["id"],
        b["id"],
    }
    after = client.get(base + "/parties").json()
    assert len(after) == 2 and all(p["customer_group_id"] == group["id"] for p in after)
    for p in after:
        original = next(v for v in (a, b) if v["id"] == p["id"])
        assert all(p[k] == v for k, v in original.items() if k != "customer_group_id")
    assert (
        client.post(base + "/customer-groups", json={"name": "grupo sintético"}).status_code == 422
    )
    assert (
        client.post(
            base + "/customer-groups", json={"name": "Outro", "member_ids": [a["id"]]}
        ).status_code
        == 409
    )
    assert (
        client.put(
            base + "/customer-groups/" + group["id"],
            json={"name": "Novo nome", "active": False, "member_ids": [b["id"]]},
        ).status_code
        == 200
    )
    updated = {p["id"]: p for p in client.get(base + "/parties").json()}
    assert updated[a["id"]]["customer_group_id"] is None
    assert updated[b["id"]]["customer_group_id"] == group["id"]
    assert (
        conn.scalar(
            text(
                "SELECT count(*) FROM audit_events WHERE organization_id=:org AND entity_type='customer_groups'"
            ),
            {"org": base.split("/")[2]},
        )
        == 2
    )
    other = client.post("/organizations", json={"name": "Outra sintética"}).json()["id"]
    other_base = "/organizations/" + other
    assert client.get(other_base + "/customer-groups").json() == []
    assert (
        client.post(
            other_base + "/customer-groups",
            json={"name": "Cruzado", "member_ids": [b["id"]]},
        ).status_code
        == 422
    )
    assert (
        client.put(
            other_base + "/customer-groups/" + group["id"], json={"name": "Inválido"}
        ).status_code
        == 404
    )
    assert (
        client.post(
            base + "/customer-groups", json={"name": "Inválido", "code": "editável"}
        ).status_code
        == 422
    )


def test_group_only_identification_preserves_bank_and_client_has_priority(statements):
    client, conn, base, _ = statements
    rows = imported(client, base)
    fields = dimensions(client, base)
    group = client.post(
        base + "/customer-groups",
        json={"name": "Grupo teste", "member_ids": [fields["party_id"]]},
    ).json()
    credit = next(r for r in rows if r["direction"] == "CREDIT")
    before = (
        conn.execute(text("SELECT * FROM bank_transactions WHERE id=:id"), {"id": credit["id"]})
        .mappings()
        .one()
    )
    url = base + f"/transactions/{credit['id']}/identification"
    body = {**fields, "party_id": None, "customer_group_id": group["id"]}
    assert client.put(url, json=body).status_code == 200
    visible = next(
        r
        for r in client.get(base + "/transactions?state=identified").json()["rows"]
        if r["id"] == credit["id"]
    )
    assert visible["party_id"] is None and visible["customer_group_name"] == group["name"]
    assert (
        client.put(
            url,
            json={**fields, "customer_group_id": group["id"], "expected_version": 1},
        ).status_code
        == 422
    )
    assert client.put(url, json={**fields, "expected_version": 1}).status_code == 200
    assert (
        conn.execute(text("SELECT * FROM bank_transactions WHERE id=:id"), {"id": credit["id"]})
        .mappings()
        .one()
        == before
    )
    debit = next(r for r in rows if r["direction"] == "DEBIT")
    assert (
        client.put(base + f"/transactions/{debit['id']}/identification", json=body).status_code
        == 422
    )
    assert (
        client.put(
            url, json={**body, "customer_group_id": str(uuid4()), "expected_version": 2}
        ).status_code
        == 422
    )


def test_shared_payer_falls_back_to_group_but_specific_client_wins():
    catalogs = {
        "parties": [
            {"id": "premium", "name": "Cliente Premium", "customer_group_id": "group"},
            {"id": "loja1", "name": "Cliente Loja Um", "customer_group_id": "group"},
            {"id": "loja2", "name": "Cliente Loja Dois", "customer_group_id": "group"},
        ],
        "customer_groups": [{"id": "group", "name": "Grupo Teste"}],
        "categories": [],
        "subcategories": [],
        "cost_centers": [],
    }

    def row(desc, party=None, group=None):
        return {
            "raw_description": desc,
            "party_id": party,
            "customer_group_id": group,
            "direction": "CREDIT",
            "movement_kind": "NORMAL",
            "account_id": "a",
            "category_id": None,
            "subcategory_id": None,
            "cost_center_id": None,
        }

    history = [
        row("PIX RECEBIDO PAGADOR COMPARTILHADO", group="group"),
        row("PIX RECEBIDO PAGADOR PREMIUM", party="premium"),
    ]
    premium = {"raw_description": "PIX RECEBIDO PAGADOR PREMIUM", "direction": "CREDIT"}
    identity = resolve_customer(history, premium, catalogs, {})
    assert identity["party_id"] == "premium" and identity["customer_group_id"] is None
    assert prioritize_customer({"party_id": "loja1"}, identity, catalogs)["party_id"] == "premium"
    target = {
        "raw_description": "PIX RECEBIDO PAGADOR COMPARTILHADO",
        "direction": "CREDIT",
        "account_id": "a",
    }
    identity = resolve_customer(history, target, catalogs, {})
    assert identity["party_id"] is None and identity["customer_group_id"] == "group"
    evidence, _ = related_evidence(history, target, catalogs, {})
    proposal = complete_suggestion(
        {"movement_kind": "NORMAL", "party_id": "loja1"}, evidence, catalogs
    )
    assert proposal["party_id"] is None and proposal["customer_group_id"] == "group"
    documentary = resolve_customer(history, target, catalogs, {"12345678901": ["premium"]})
    assert documentary["customer_group_id"] == "group"
    direct = {**target, "raw_description": "PIX RECEBIDO 12345678901"}
    assert (
        resolve_customer(history, direct, catalogs, {"12345678901": ["premium"]})["party_id"]
        == "premium"
    )
    ambiguous = [
        row("PIX RECEBIDO PAGADOR COMPARTILHADO", party="loja1"),
        row("PIX RECEBIDO PAGADOR COMPARTILHADO", party="loja2"),
    ]
    assert resolve_customer(ambiguous, target, catalogs, {})["customer_group_id"] == "group"
    unknown = prioritize_customer({"party_id": "loja1"}, {}, catalogs)
    assert unknown["party_id"] is None


def test_historical_group_links_preserve_specific_clients_and_are_idempotent(
    statements,
):
    client, _, base, _ = statements
    rows = imported(client, base)
    fields = dimensions(client, base)
    sub = client.post(
        base + "/subcategories",
        json={"name": "PIX Faturado", "category_id": fields["category_id"]},
    ).json()
    fields["subcategory_id"] = sub["id"]
    group = client.post(
        base + "/customer-groups",
        json={"name": "Grupo sintético", "member_ids": [fields["party_id"]]},
    ).json()
    credits = [r for r in rows if r["direction"] == "CREDIT"]
    assert group["name"] == "Grupo sintético"
    for i, r in enumerate(credits):
        assert (
            client.put(
                base + f"/transactions/{r['id']}/identification",
                json={**fields, "party_id": fields["party_id"] if i == 0 else None},
            ).status_code
            == 200
        )
    raw = "Pagador;Grupo;Quantidade;Total\nCLIENTE SINTETICO;Grupo sintético;3;300.00\n"
    body = {
        "file_name": "grupos.csv",
        "content": base64.b64encode(raw.encode()).decode(),
        "through": "2026-01-02",
    }
    preview = client.post(base + "/payer-links/preview", json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["new"] == 2
    result = client.post(
        base + "/payer-links/commit", json={**body, "token": preview.json()["token"]}
    )
    assert result.status_code == 200, result.text
    assert result.json()["linked"] == 2 and result.json()["verified"] == 3
    checked = client.get(base + "/transactions?state=identified").json()["rows"]
    assert sum(bool(r["party_id"]) for r in checked) == 1
    assert sum(bool(r["customer_group_id"]) for r in checked) == 2
    assert client.post(base + "/payer-links/preview", json=body).json()["new"] == 0
