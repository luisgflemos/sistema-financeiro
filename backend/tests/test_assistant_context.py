import json
from uuid import UUID, uuid4

import httpx

from app import assistant
from app.assistant_context import readable_context, suggestion_diagnostic


def context_fixture():
    category, sub, party, center = [str(uuid4()) for _ in range(4)]
    return {
        "catalogs": {
            "categories": [{"id": category, "name": "Recebimento", "active": True}],
            "subcategories": [
                {"id": sub, "name": "PIX Faturado", "category_id": category, "active": True}
            ],
            "parties": [{"id": party, "name": "Cliente Modelo", "active": True}],
            "cost_centers": [{"id": center, "name": "Centro Modelo", "active": True}],
        },
        "transaction": {
            "suggestion": {
                "category_id": category,
                "subcategory_id": None,
                "party_id": party,
                "cost_center_id": None,
                "confidence": "HIGH",
                "movement_kind": "NORMAL",
            }
        },
        "related_history": {
            "same_account": {
                "matching_records": 16,
                "match_basis": {"unique_name_in_bank_text": 16},
                "fields": {
                    "subcategory_id": {
                        "unanimous": True,
                        "observations": 16,
                        "missing": 0,
                        "values": {sub: 16},
                    }
                },
            }
        },
        "confirmed_examples": [{"category_id": UUID(category), "subcategory_id": UUID(sub)}],
    }


def test_names_resolved_before_model_without_confusing_parent_and_child():
    context = context_fixture()
    diagnostic = suggestion_diagnostic(context)
    assert diagnostic["observed_subclassification"] == "PIX Faturado"
    assert diagnostic["matching_records"] == diagnostic["occurrences"] == 16
    assert diagnostic["stored_suggestion_missing_subclassification"]
    assert "omissão" in diagnostic["stored_suggestion_assessment"]
    assert "revisão" in diagnostic["confidence_assessment"]
    assert diagnostic["historical_client_link"]["without_registered_client_link"] == 16
    assert diagnostic["historical_client_link"]["with_registered_client_link"] == 0
    context["recognition_review"] = diagnostic
    result = readable_context(context)
    assert result["confirmed_examples"][0] == {
        "classificação": "Recebimento",
        "subclassificação": "PIX Faturado",
    }
    values = result["related_history"]["same_account"]["fields"]["subclassificação"]["values"]
    assert values == [{"nome": "PIX Faturado", "quantidade": 16}]
    assert result["catalogs"]["subcategories"][0]["classificação"] == "Recebimento"
    serialized = json.dumps(result, default=str)
    for table in context["catalogs"].values():
        for row in table:
            assert row["id"] not in serialized
    # Não altera a estrutura interna usada pelas consultas.
    assert isinstance(context["confirmed_examples"][0]["subcategory_id"], UUID)


def test_no_unanimity_does_not_invent_a_pattern():
    context = context_fixture()
    context["related_history"]["same_account"]["fields"]["subcategory_id"]["unanimous"] = False
    assert "observed_subclassification" not in suggestion_diagnostic(context)


def test_provider_gets_names_and_never_returns_internal_codes(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    context = context_fixture()
    sub = context["catalogs"]["subcategories"][0]["id"]
    context["recognition_review"] = suggestion_diagnostic(context)

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            body = kwargs["json"]
            assert sub not in json.dumps(body)
            assert "PIX Faturado" in body["input"][0]["content"]
            assert "omissão" in body["input"][0]["content"]
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "status": "completed",
                    "output": [
                        {
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "Subclassificação "
                                    + sub
                                    + "; partido Cliente Modelo. "
                                    + str(uuid4()),
                                }
                            ]
                        }
                    ],
                },
            )

    monkeypatch.setattr(assistant.httpx, "Client", FakeClient)
    response = assistant.generate_answer(
        [
            assistant.Message(role="user", content="Verifique " + sub),
        ],
        context,
    )
    assert "PIX Faturado" in response and sub not in response
    assert "partido" not in response and "cliente/fornecedor" in response
    assert "[cadastro não disponível]" in response
