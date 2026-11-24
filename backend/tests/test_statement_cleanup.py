import json
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_planning import link, new_plan
from test_statements import source
from test_statements import statements as statement_fixture  # noqa: F401
from test_transactions import dimensions, imported


@pytest.fixture
def statements(statement_fixture):  # noqa: F811
    return statement_fixture


def test_scoped_removal_backup_restoration_and_reimport(statements):
    client, connection, base, accounts = statements
    rows = imported(client, base)
    values = dimensions(client, base)
    new_plan(client, base, frequency="MONTHLY", occurrences=3)
    assert (
        client.put(
            base + "/transactions/" + rows[0]["id"] + "/identification", json=values
        ).status_code
        == 200
    )
    payload = {"files": [source(account="789012", name="outro.xlsx")]}
    preview = client.post(base + "/statements/preview", json=payload).json()
    assert (
        client.post(
            base + "/statements/commit", json={**payload, "token": preview["token"]}
        ).status_code
        == 200
    )
    file_id = rows[0]["import_file_id"]
    endpoint = base + "/statement-cleanup"
    before = {
        path: client.get(base + "/" + path).json()
        for path in (
            "bank-accounts",
            "categories",
            "subcategories",
            "cost-centers",
            "parties",
            "planned-entries",
        )
    }
    summary = client.get(endpoint + "/" + file_id + "/preview").json()
    assert summary["movements"] == 3
    assert summary["identifications"] == 1
    assert client.post(endpoint, json={"file_id": file_id, "token": "0" * 64}).status_code == 409
    response = client.post(endpoint, json={"file_id": file_id, "token": summary["token"]})
    assert response.status_code == 200, response.text
    removal_id = response.json()["removal_id"]
    assert client.get(base + "/transactions").json()["total"] == 3
    assert all(
        row["account_id"] == accounts[1]
        for row in client.get(base + "/transactions").json()["rows"]
    )
    for path, records in before.items():
        assert client.get(base + "/" + path).json() == records
    backup = connection.scalar(
        text("SELECT old_json FROM audit_events WHERE id=:id"), {"id": removal_id}
    )
    assert json.loads(backup["statement_contents"][0])["original_bytes"].startswith("\\x")
    assert len(backup["transaction_identifications"]) == 1
    restored = client.post(endpoint + "/" + removal_id + "/restore", json={})
    assert restored.status_code == 200, restored.text
    assert restored.json()["restored"] == 3
    assert client.get(base + "/transactions").json()["total"] == 6
    assert client.get(base + "/transactions?state=identified").json()["total"] == 1
    assert client.get(endpoint).json() == []
    assert client.post(endpoint + "/" + removal_id + "/restore", json={}).status_code == 404
    # Os gatilhos continuam protegendo os originais após a operação excepcional.
    with pytest.raises(DBAPIError), connection.begin_nested():
        connection.execute(
            text("DELETE FROM bank_transactions WHERE id=:id"), {"id": rows[0]["id"]}
        )
    summary = client.get(endpoint + "/" + file_id + "/preview").json()
    response = client.post(endpoint, json={"file_id": file_id, "token": summary["token"]})
    removal_id = response.json()["removal_id"]
    payload = {"files": [source()]}
    preview = client.post(base + "/statements/preview", json=payload).json()
    assert preview["new"] == 3
    assert (
        client.post(
            base + "/statements/commit", json={**payload, "token": preview["token"]}
        ).status_code
        == 200
    )
    assert client.post(endpoint + "/" + removal_id + "/restore", json={}).status_code == 409
    assert client.get(base + "/transactions").json()["total"] == 6


def test_cross_organization_and_stale_preview_are_rejected(statements):
    client, _, base, _ = statements
    rows = imported(client, base)
    file_id = rows[0]["import_file_id"]
    endpoint = base + "/statement-cleanup"
    summary = client.get(endpoint + "/" + file_id + "/preview").json()
    values = dimensions(client, base)
    assert (
        client.put(
            base + "/transactions/" + rows[0]["id"] + "/identification", json=values
        ).status_code
        == 200
    )
    assert (
        client.post(endpoint, json={"file_id": file_id, "token": summary["token"]}).status_code
        == 409
    )
    other = client.post("/organizations", json={"name": "Outra sintética"}).json()["id"]
    foreign = f"/organizations/{other}/statement-cleanup"
    assert client.get(foreign + "/" + file_id + "/preview").status_code == 404
    assert (
        client.post(foreign, json={"file_id": file_id, "token": summary["token"]}).status_code
        == 404
    )
    assert client.get(endpoint + "/" + str(uuid4()) + "/preview").status_code == 404
    assert client.get(base + "/transactions").json()["total"] == 3


def test_shared_movements_block_removal(statements):
    client, _, base, _ = statements
    rows = imported(client, base)
    payload = {"files": [source(trailing=True, name="sobreposto.xlsx")]}
    preview = client.post(base + "/statements/preview", json=payload).json()
    assert (
        client.post(
            base + "/statements/commit", json={**payload, "token": preview["token"]}
        ).status_code
        == 200
    )
    response = client.get(base + "/statement-cleanup/" + rows[0]["import_file_id"] + "/preview")
    assert response.status_code == 409
    assert client.get(base + "/transactions").json()["total"] == 3


def test_settled_plans_are_never_removed(statements):
    client, _, base, _ = statements
    rows = imported(client, base)
    credit = next(row for row in rows if row["direction"] == "CREDIT")
    plans, _ = new_plan(client, base)
    assert link(client, base, plans[0], credit).status_code == 200
    before = client.get(base + "/planned-entries").json()
    endpoint = base + "/statement-cleanup"
    assert client.get(endpoint + "/" + credit["import_file_id"] + "/preview").status_code == 409
    assert (
        client.post(
            endpoint, json={"file_id": credit["import_file_id"], "token": "0" * 64}
        ).status_code
        == 409
    )
    assert client.get(base + "/planned-entries").json() == before
    assert client.get(base + "/transactions").json()["total"] == 3
