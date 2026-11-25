import base64
import io
from datetime import datetime

import pytest
from openpyxl import load_workbook
from test_historical_import import catalogs, upload
from test_statements import source
from test_statements import statements as statement_fixture  # noqa: F401


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def commit(client, base, payload):
    preview = client.post(base + "/historical-import/preview", json=payload)
    assert preview.status_code == 200, preview.text
    response = client.post(
        base + "/historical-import/commit", json={**payload, "token": preview.json()["token"]}
    )
    assert response.status_code == 200, response.text
    return response.json()


def day23(description="PIX NOVO SINTETICO"):
    rows = [
        [
            "Conta A",
            datetime(2026, 11, 23),
            description,
            "001",
            100,
            None,
            "Recebimento",
            "PIX à Vista",
            "L",
            "202611",
            "Centro sintético",
        ]
        for _ in range(2)
    ]
    rows.append(
        [
            "Conta B",
            datetime(2026, 11, 23),
            "TRANSFERENCIA NOVA",
            None,
            None,
            -50,
            "Transferência Bancária",
            "Transferência Bancária",
            "L",
            "202611",
            None,
        ]
    )
    return {**upload(rows), "mode": "append"}


def test_append_preserves_old_history_day24_and_masters_and_is_idempotent(statements):
    client, _, base, _ = statements
    catalogs(client, base)
    commit(client, base, upload())
    # Um extrato de 24/11 já existe, pendente: não pode ser tocado pelo acréscimo do dia 23.
    original = source(single=True)
    book = load_workbook(io.BytesIO(base64.b64decode(original["content"])))
    book.active["A4"] = datetime(2026, 11, 24)
    output = io.BytesIO()
    book.save(output)
    files = [
        {
            "file_name": "dia24-sintetico.xlsx",
            "content": base64.b64encode(output.getvalue()).decode(),
        }
    ]
    preview = client.post(base + "/statements/preview", json={"files": files}).json()
    assert (
        client.post(
            base + "/statements/commit", json={"files": files, "token": preview["token"]}
        ).status_code
        == 200
    )
    before24 = client.get(base + "/transactions?state=all&start=2026-11-24&end=2026-11-24").json()
    before_masters = {
        key: client.get(base + "/" + key).json()
        for key in ("bank-accounts", "categories", "subcategories", "cost-centers", "parties")
    }
    result = commit(client, base, day23())
    assert result["imported"] == 3
    rows = client.get(base + "/transactions?state=all&start=2026-11-23&end=2026-11-23").json()[
        "rows"
    ]
    assert len(rows) == 3 and all(
        r["state"] == "identified" and r["method"] == "OPERATOR" for r in rows
    )
    assert len({r["id"] for r in rows}) == 3
    assert (
        before24
        == client.get(base + "/transactions?state=all&start=2026-11-24&end=2026-11-24").json()
    )
    assert all(
        client.get(base + "/" + key).json() == values for key, values in before_masters.items()
    )
    filters = "&".join("file_ids=" + identifier for identifier in result["file_ids"])
    summary = client.get(base + "/historical-import/summary?" + filters).json()
    assert sum(r["count"] for r in summary) == sum(r["identified"] for r in summary) == 3
    assert commit(client, base, day23())["imported"] == 0
    assert client.get(base + "/transactions?state=all").json()["total"] == 8
    for action in ("preview", "commit"):
        assert (
            client.post(
                base + "/historical-import/" + action, json=day23("OUTRA DESCRICAO")
            ).status_code
            == 409
        )
    assert client.get(base + "/transactions?state=all").json()["total"] == 8


def test_mode_is_bound_to_preview_and_initial_mode_remains_restricted(statements):
    client, _, base, _ = statements
    catalogs(client, base)
    payload = upload()
    preview = client.post(base + "/historical-import/preview", json=payload).json()
    assert (
        client.post(
            base + "/historical-import/commit",
            json={**payload, "mode": "append", "token": preview["token"]},
        ).status_code
        == 409
    )
    assert client.get(base + "/transactions?state=all").json()["total"] == 0
    commit(client, base, payload)
    assert (
        client.post(
            base + "/historical-import/preview", json={**day23(), "mode": "initial"}
        ).status_code
        == 409
    )
