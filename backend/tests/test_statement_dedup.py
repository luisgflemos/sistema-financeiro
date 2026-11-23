from app.statement_dedup import classify_rows


def movement(number, signature="position", previous="before", following="after"):
    return {
        "row": number,
        "fingerprint": "same-payment",
        "signature": signature,
        "previous_signature": previous,
        "next_signature": following,
    }


def test_one_stored_occurrence_cannot_hide_two_incoming_occurrences():
    old = {
        "same-payment": [
            {
                "id": "stored",
                "signature": "position",
                "previous_signature": "before",
                "next_signature": "after",
            }
        ]
    }
    result = classify_rows([movement(4), movement(8)], old, {})
    assert [row["status"] for row in result] == ["review", "review"]


def test_identical_data_without_bank_sequence_remains_an_explicit_doubt():
    old = {
        "same-payment": [
            {
                "id": "stored",
                "signature": "position",
                "previous_signature": None,
                "next_signature": None,
            }
        ]
    }
    result = classify_rows([movement(4, previous=None, following=None)], old, {})
    assert result[0]["status"] == "review"
    assert result[0]["reason"]


def test_changed_balance_without_located_prior_occurrence_is_not_silently_discarded():
    old = {
        "same-payment": [
            {
                "id": "stored",
                "signature": "old-position",
                "previous_signature": "old-before",
                "next_signature": "old-after",
            }
        ]
    }
    result = classify_rows([movement(4, signature="new-position")], old, {})
    assert result[0]["status"] == "review"
