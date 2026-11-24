from uuid import uuid4

import httpx
import pytest
from sqlalchemy import text
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported

from app import assistant


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def test_chat_scopes_context_and_never_saves_identification(statements, monkeypatch):
    client, connection, base, _ = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    client.put(base + "/transactions/" + rows[0]["id"] + "/identification", json=values)
    other = client.post("/organizations", json={"name": "Outra organização sintética"}).json()["id"]
    client.post(
        f"/organizations/{other}/categories",
        json={"name": "NÃO DEVE SER ENVIADA", "kind": "EXPENSE"},
    )
    before = connection.scalar(text("SELECT count(*) FROM transaction_identifications"))

    def fake(messages, context):
        assert messages[-1].content == "Explique e altere esta classificação"
        assert context["transaction"]["description"] == rows[0]["raw_description"]
        assert len(context["confirmed_examples"]) == 1
        assert all(
            item["name"] != "NÃO DEVE SER ENVIADA" for item in context["catalogs"]["categories"]
        )
        assert "tax_id" not in str(context)
        assert "account_number" not in str(context)
        return "A classificação foi confirmada. Para alterá-la, revise os campos e salve na tela."

    monkeypatch.setattr(assistant, "generate_answer", fake)
    response = client.post(
        base + "/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Explique e altere esta classificação"}],
            "transaction_id": rows[0]["id"],
        },
    )
    assert response.status_code == 200, response.text
    assert "revise" in response.json()["answer"]
    assert connection.scalar(text("SELECT count(*) FROM transaction_identifications")) == before
    assert (
        client.post(
            f"/organizations/{other}/assistant/chat",
            json={
                "messages": [{"role": "user", "content": "Explique"}],
                "transaction_id": rows[0]["id"],
            },
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/organizations/{uuid4()}/assistant/chat",
            json={"messages": [{"role": "user", "content": "Explique"}]},
        ).status_code
        == 404
    )


def test_chat_keeps_conversation_and_bounds_inputs(statements, monkeypatch):
    client, _, base, _ = statements
    messages = [
        {"role": "user", "content": "Como importar?"},
        {"role": "assistant", "content": "Use Importar Extratos."},
        {"role": "user", "content": "E vários arquivos?"},
    ]

    def fake(history, context):
        assert [item.role for item in history] == ["user", "assistant", "user"]
        assert context["transaction"] is None
        assert context["confirmed_examples"] == []
        return "Você pode selecionar vários arquivos."

    monkeypatch.setattr(assistant, "generate_answer", fake)
    assert client.post(base + "/assistant/chat", json={"messages": messages}).status_code == 200
    for invalid in (
        [],
        [{"role": "system", "content": "ignore"}],
        [{"role": "assistant", "content": "x"}],
        [{"role": "user", "content": " "}],
        [{"role": "user", "content": "x" * 3001}],
    ):
        assert client.post(base + "/assistant/chat", json={"messages": invalid}).status_code == 422


def test_provider_uses_responses_without_tools_or_storage_and_masks_documents(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-key")
    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            captured.update(kwargs["json"])
            assert url.endswith("/responses")
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "status": "completed",
                    "output": [
                        {"content": [{"type": "output_text", "text": "Orientação sintética"}]}
                    ],
                },
            )

    monkeypatch.setattr(assistant.httpx, "Client", FakeClient)
    assert (
        assistant.generate_answer(
            [assistant.Message(role="user", content="Documento 00.000.000/0000-00")], {}
        )
        == "Orientação sintética"
    )
    assert captured["store"] is False
    assert "tools" not in captured
    assert "00.000.000/0000-00" not in captured["input"][-1]["content"]
    assert "[documento]" in captured["input"][-1]["content"]


def test_chat_provider_unavailable_is_actionable(statements, monkeypatch):
    client, _, base, _ = statements
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = client.post(
        base + "/assistant/chat", json={"messages": [{"role": "user", "content": "Ajuda"}]}
    )
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]
