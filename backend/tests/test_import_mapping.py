from app.import_mapping import suggest_mapping
from app.table_imports import FIELDS


def test_erp_headers_and_ambiguous_phone_columns():
    headers = [
        "NOME FANTASIA",
        "RESPONSÁVEL FINANCEIRO",
        "TEL. COMERCIAL",
        "TEL. CELULAR FINANCEIRO",
        "E-MAIL",
        "CPF",
    ]
    mapping, suggestions, ambiguities = suggest_mapping("parties", FIELDS["parties"], headers, [])
    assert mapping == {"display_name": 0, "tax_id": 5, "contact_name": 1, "contact_email": 4}
    assert "contact_phone" not in mapping
    assert [item["column"] for item in ambiguities["contact_phone"]] == [2, 3]
    assert suggestions["display_name"]["confidence"] == "Alta"
    assert suggestions["contact_name"]["reason"]


def test_content_recognition_explains_sample_and_avoids_guessing_identifiers():
    headers = ["Coluna A", "Coluna B"]
    rows = [["pessoa@example.test", "12345678901"], ["outra@example.test", "00000000000"]]
    mapping, suggestions, _ = suggest_mapping("parties", FIELDS["parties"], headers, rows)
    assert mapping == {"contact_email": 0}
    assert suggestions["contact_email"]["confidence"] == "Média"
    assert "amostra" in suggestions["contact_email"]["reason"]


def test_two_names_require_choice_and_never_reuse_column():
    mapping, _, ambiguities = suggest_mapping(
        "parties", FIELDS["parties"], ["Nome Fantasia", "Razão Social", "E-mail", "Email"], []
    )
    assert not mapping
    assert {"display_name", "contact_email"} <= ambiguities.keys()


def test_bank_account_number_is_not_suggested_as_document():
    mapping, _, _ = suggest_mapping(
        "bank-accounts", FIELDS["bank-accounts"], ["Número da conta"], [["12345678901234"]]
    )
    assert mapping == {"account_number": 0}
