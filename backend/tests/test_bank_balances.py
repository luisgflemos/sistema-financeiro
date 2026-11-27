import base64
from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from test_statements import source
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import imported

from app.bank_balances import build_ledger, order_day


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def row(identifier, amount, balance, day="2026-01-02", file="file-a", source_row=4):
    return {
        "id": identifier,
        "amount": Decimal(str(abs(amount))),
        "direction": "CREDIT" if amount > 0 else "DEBIT",
        "bank_balance": None if balance is None else Decimal(str(balance)),
        "posted_on": date.fromisoformat(day),
        "import_file_id": file,
        "file_created_at": "2026-01-03",
        "file_name": file + ".csv",
        "source_row": source_row,
        "raw_description": "Movimento sintético",
    }


ACCOUNT = {"id": "account-a", "label": "Conta sintética", "active": True, "currency": "BRL"}


def test_opening_from_earliest_reference_preserves_descending_source_order():
    summary, rows = build_ledger(
        ACCOUNT, [row("new", -30, 170, source_row=4), row("old", 100, 200, source_row=5)], []
    )
    assert summary["opening"]["amount"] == Decimal(100)
    assert summary["calculated_balance"] == Decimal(170)
    assert summary["state"] == "consistent"
    assert [r["id"] for r in rows] == ["old", "new"]
    assert [r["calculated_balance"] for r in rows] == [Decimal(200), Decimal(170)]


def test_history_before_reference_is_not_fabricated_and_gaps_raise_differences():
    summary, rows = build_ledger(
        ACCOUNT,
        [
            row("history", 20, None, day="2025-01-01"),
            row("anchor", 100, 200),
            row("gap", 10, 500, day="2026-01-04", file="file-b"),
        ],
        [],
    )
    assert rows[0]["calculated_balance"] is None
    assert summary["unreferenced_movements"] == 1
    assert summary["calculated_balance"] == Decimal(210)
    assert summary["last_bank_balance"]["amount"] == Decimal(500)
    assert summary["differences"][0]["difference"] == Decimal(-290)
    assert summary["state"] == "difference"


def test_multi_file_order_is_only_confident_when_balance_chain_is_unique():
    ordered, ambiguous = order_day(
        [row("later", 50, 250, file="b"), row("earlier", 100, 200, file="a")], Decimal(100)
    )
    assert [r["id"] for r in ordered] == ["earlier", "later"] and not ambiguous
    _, ambiguous = order_day(
        [row("a", 10, None, file="a"), row("b", 20, None, file="b")], Decimal(100)
    )
    assert ambiguous
    summary, _ = build_ledger(
        ACCOUNT, [row("later", 50, 250, file="b"), row("earlier", 100, 200, file="a")], []
    )
    assert summary["opening"]["amount"] == Decimal(100)
    assert summary["calculated_balance"] == Decimal(250)
    assert summary["state"] == "consistent"


def test_no_reference_means_unknown_not_zero():
    summary, rows = build_ledger(ACCOUNT, [row("missing", 100, None)], [])
    assert summary["needs_opening"] and summary["calculated_balance"] is None
    assert rows[0]["calculated_balance"] is None


def event(kind, amount, day="2026-01-02", reversed=False):
    return {
        "id": str(uuid4()),
        "kind": kind,
        "amount": Decimal(amount),
        "posted_on": date.fromisoformat(day),
        "reason": "Motivo sintético",
        "reversed": reversed,
        "created_at": "2026-01-03",
    }


def test_manual_negative_opening_and_adjustment_do_not_become_cash_movements():
    opening = event("OPENING", "-50")
    adjustment = event("ADJUSTMENT", "-10")
    summary, rows = build_ledger(ACCOUNT, [row("x", 100, None)], [opening, adjustment])
    assert summary["opening"]["source"] == "manual"
    assert summary["calculated_balance"] == Decimal(40)
    assert rows[-1]["kind"] == "ADJUSTMENT"
    assert summary["state"] == "adjusted"
    adjustment["reversed"] = True
    assert build_ledger(ACCOUNT, [row("x", 100, None)], [opening, adjustment])[0][
        "calculated_balance"
    ] == Decimal(50)


def test_imported_reference_supersedes_manual_without_double_applying_old_adjustments():
    summary, _ = build_ledger(
        ACCOUNT,
        [row("ref", 100, 500)],
        [event("OPENING", "10", day="2025-01-01"), event("ADJUSTMENT", "20", day="2025-01-02")],
    )
    assert summary["manual_opening_superseded"]
    assert summary["calculated_balance"] == Decimal(500)


def test_imported_balances_overview_filter_pagination_and_no_double_import(statements):
    client, _, base, accounts = statements
    movements = imported(client, base)
    path = base + "/bank-balances/" + accounts[0]
    result = client.get(path).json()
    assert result["summary"]["state"] == "consistent"
    assert result["summary"]["opening"]["amount"] == "-50.00"
    assert result["totals"] == {
        "opening": "-50.00",
        "credits": "300.00",
        "debits": "30.00",
        "adjustments": "0.00",
        "closing": "220.00",
    }
    assert result["total"] == 4
    for page in range(1, 5):
        part = client.get(path, params={"page": page, "page_size": 1}).json()
        assert part["totals"] == result["totals"]
        assert (
            part["rows"][0]["calculated_balance"] == result["rows"][page - 1]["calculated_balance"]
        )
    reverse = client.get(path, params={"sort_by": "date", "sort_order": "desc"}).json()
    assert [r["id"] for r in reverse["rows"]] == [r["id"] for r in reversed(result["rows"])]
    assert client.get(path, params={"start": "2026-01-03"}).json()["totals"]["opening"] == "220.00"
    assert client.get(path, params={"end": "2025-01-01"}).json()["totals"]["opening"] is None
    payload = {"files": [source()]}
    preview = client.post(base + "/statements/preview", json=payload).json()
    client.post(base + "/statements/commit", json={**payload, "token": preview["token"]})
    assert client.get(path).json()["total"] == len(movements)
    assert client.get(base + "/bank-balances").json()["accounts"][0]["label"]


def test_adjustments_are_idempotent_audited_isolated_and_reversible(statements):
    client, conn, base, accounts = statements
    imported(client, base)
    path = base + "/bank-balances/" + accounts[0]
    payload = {
        "kind": "ADJUSTMENT",
        "posted_on": "2026-01-02",
        "amount": "-20.00",
        "reason": "Conferência sintética",
        "request_key": str(uuid4()),
    }
    saved = client.post(path + "/events", json=payload)
    assert saved.status_code == 201, saved.text
    assert client.post(path + "/events", json=payload).json()["repeated"]
    assert client.post(path + "/events", json={**payload, "amount": "-21.00"}).status_code == 409
    changed = client.get(path).json()
    assert changed["totals"]["closing"] == "200.00"
    assert changed["totals"]["debits"] == "30.00"
    assert changed["totals"]["adjustments"] == "-20.00"
    assert changed["summary"]["state"] == "adjusted"
    assert client.get(base + "/transactions?state=all").json()["total"] == 4
    other = client.post("/organizations", json={"name": "Outra organização"}).json()["id"]
    assert client.get(f"/organizations/{other}/bank-balances/" + accounts[0]).status_code == 404
    assert (
        client.post(
            f"/organizations/{other}/bank-balances/" + accounts[0] + "/events", json=payload
        ).status_code
        == 404
    )
    reverse_path = path + "/events/" + saved.json()["id"] + "/reverse"
    assert client.post(reverse_path, json={"reason": "Correção sintética"}).status_code == 200
    assert client.post(reverse_path, json={"reason": "Correção sintética"}).json()["repeated"]
    assert client.get(path).json()["totals"]["closing"] == "220.00"
    assert client.get(path).json()["events"][0]["reversed"]
    assert (
        conn.scalar(
            text(
                "SELECT count(*) FROM audit_events WHERE entity_type='bank_balance_events' AND entity_id=:id"
            ),
            {"id": saved.json()["id"]},
        )
        == 1
    )


def test_missing_reference_manual_opening_and_validation(statements):
    client, _, base, accounts = statements
    path = base + "/bank-balances/" + accounts[1]
    assert client.get(path).json()["summary"]["needs_opening"]
    payload = {
        "kind": "OPENING",
        "posted_on": "2026-01-02",
        "amount": "0.00",
        "reason": "Saldo inicial sintético",
        "request_key": str(uuid4()),
    }
    assert client.post(path + "/events", json=payload).status_code == 201
    assert client.get(path).json()["totals"]["opening"] == "0.00"
    assert (
        client.post(path + "/events", json={**payload, "request_key": str(uuid4())}).status_code
        == 409
    )
    for fields in (
        {"amount": "10.001"},
        {"amount": "NaN"},
        {"posted_on": "2099-01-01"},
        {"reason": "   "},
    ):
        assert (
            client.post(
                path + "/events", json={**payload, **fields, "request_key": str(uuid4())}
            ).status_code
            == 422
        )
    assert client.get(path, params={"start": "2026-02-02", "end": "2026-01-01"}).status_code == 422


def test_bank_reference_blocks_unnecessary_manual_opening(statements):
    client, _, base, accounts = statements
    imported(client, base)
    response = client.post(
        base + "/bank-balances/" + accounts[0] + "/events",
        json={
            "kind": "OPENING",
            "posted_on": "2026-01-02",
            "amount": "100.00",
            "reason": "Abertura indevida",
            "request_key": str(uuid4()),
        },
    )
    assert response.status_code == 409


def test_import_without_balance_requests_manual_reference_and_preserves_zero_unknown(statements):
    client, _, base, accounts = statements
    csv = "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$)\n02/01/2026;CREDITO SEM SALDO;1;100\n02/01/2026;DEBITO SEM SALDO;2;-30\n"
    payload = {
        "files": [
            {"file_name": "sem-saldo.csv", "content": base64.b64encode(csv.encode()).decode()}
        ]
    }
    preview = client.post(base + "/statements/preview", json=payload)
    assert preview.status_code == 200, preview.text
    saved = client.post(
        base + "/statements/commit", json={**payload, "token": preview.json()["token"]}
    )
    assert saved.status_code == 200, saved.text
    path = base + "/bank-balances/" + accounts[0]
    result = client.get(path).json()
    assert result["summary"]["needs_opening"]
    assert all(
        r["bank_balance"] is None and r["calculated_balance"] is None for r in result["rows"]
    )
    repeated = client.post(base + "/statements/preview", json=payload).json()
    assert (
        client.post(
            base + "/statements/commit", json={**payload, "token": repeated["token"]}
        ).status_code
        == 200
    )
    assert client.get(path).json()["total"] == 2
    response = client.post(
        path + "/events",
        json={
            "kind": "OPENING",
            "posted_on": "2026-01-02",
            "amount": "50.00",
            "reason": "Abertura validada manualmente",
            "request_key": str(uuid4()),
        },
    )
    assert response.status_code == 201, response.text
    assert client.get(path).json()["totals"]["closing"] == "120.00"
    assert client.get(path).json()["summary"]["state"] == "manual"


def test_partial_balance_reference_still_derives_opening_without_operator():
    summary, rows = build_ledger(
        ACCOUNT, [row("later", 100, 120, source_row=4), row("early", -30, None, source_row=5)], []
    )
    assert summary["opening"]["amount"] == Decimal(50)
    assert [r["calculated_balance"] for r in rows] == [Decimal(20), Decimal(120)]
    assert not summary["needs_opening"]
    summary, _ = build_ledger(
        ACCOUNT, [row("later", 100, None, source_row=4), row("early", -30, 20, source_row=5)], []
    )
    assert summary["calculated_balance"] == Decimal(120)
    assert summary["state"] == "unverified"


def test_missing_balance_never_becomes_duplicate_evidence_and_bad_partial_chain_is_rejected():
    from app.statement_dedup import classify_rows
    from app.statement_parser import parse_statement

    incoming = {
        "row": 4,
        "fingerprint": "same",
        "signature": None,
        "previous_signature": "neighbor",
    }
    previous = {"same": [{"id": "old", "signature": None, "previous_signature": "neighbor"}]}
    assert classify_rows([incoming], previous, {})[0]["status"] == "review"
    csv = "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;NOVO;1;100;500\n02/01/2026;MEIO;2;20;\n02/01/2026;ANTIGO;3;10;100\n"
    with pytest.raises(ValueError, match="saldos não conferem"):
        parse_statement("saldo-invalido.csv", base64.b64encode(csv.encode()).decode())
