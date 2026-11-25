"""Cobertura da configuração observada no Railway, somente com chaves sintéticas."""

from uuid import uuid4

import httpx
import pytest

from app import assistant, recognition
from app.ai_config import api_key


@pytest.mark.parametrize(
    "canonical,alias,expected",
    [
        (None, None, ""),
        (" ", " ", ""),
        (None, " synthetic-alias ", "synthetic-alias"),
        ("synthetic-canonical", "synthetic-alias", "synthetic-canonical"),
    ],
)
def test_key_resolution(monkeypatch, canonical, alias, expected):
    for name, value in (("OPENAI_API_KEY", canonical), ("OPEN_API_KEY", alias)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    assert api_key() == expected
    assert recognition.config(uuid4()) == {"enabled": bool(expected)}


def test_chat_and_recognition_use_existing_alias_without_exposing_it(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPEN_API_KEY", "synthetic-existing-key")
    calls = []

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            assert kwargs["headers"]["Authorization"] == "Bearer synthetic-existing-key"
            assert "synthetic-existing-key" not in str(kwargs["json"])
            assert kwargs["json"]["store"] is False
            calls.append(url)
            value = '{"items": []}' if "text" in kwargs["json"] else "Orientação sintética"
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "status": "completed",
                    "output": [{"content": [{"type": "output_text", "text": value}]}],
                },
            )

    monkeypatch.setattr(assistant.httpx, "Client", Client)
    assert (
        assistant.generate_answer([assistant.Message(role="user", content="Ajuda")], {})
        == "Orientação sintética"
    )
    assert recognition.generative_suggestions({})[0] == []
    assert len(calls) == 2
