from sqlalchemy import text


def test_bank_account_lifecycle_and_audit(catalog_client):
    client, connection = catalog_client
    organization = text("INSERT INTO organizations (name) VALUES ('Sintética') RETURNING id")
    first_org = connection.execute(organization).scalar_one()
    other_org = connection.execute(organization).scalar_one()
    endpoint = f"/organizations/{first_org}/bank-accounts"
    payload = {
        "code": "conta-teste",
        "bank_code": "000",
        "branch": "0000",
        "account_number_masked": "**00",
        "holder_name": "Titular sintético",
    }

    invalid = client.post(endpoint, json={**payload, "account_number_masked": "0000"})
    assert invalid.status_code == 422
    created = client.post(endpoint, json=payload)
    assert created.status_code == 201
    assert created.json()["currency"] == "BRL"
    account_id = created.json()["id"]
    url = f"{endpoint}/{account_id}"
    assert client.post(endpoint, json=payload).status_code == 409
    other_url = f"/organizations/{other_org}/bank-accounts/{account_id}"
    assert client.get(other_url).status_code == 404
    assert client.delete(other_url).status_code == 404
    assert client.get(url).json()["active"] is True
    updated = client.put(url, json={**payload, "code": "revisado"})
    assert updated.status_code == 200
    assert updated.json()["code"] == "revisado"
    assert client.delete(url).status_code == 204
    assert client.delete(url).status_code == 204
    assert client.get(endpoint, params={"active": True}).json() == []
    assert client.get(endpoint, params={"active": False}).json()[0]["id"] == account_id

    audit = connection.execute(
        text("SELECT action, new_json FROM audit_events WHERE entity_id = :id"),
        {"id": account_id},
    ).all()
    assert sorted(event.action for event in audit) == ["create", "deactivate", "update"]
    assert all("holder_name" not in event.new_json for event in audit)
