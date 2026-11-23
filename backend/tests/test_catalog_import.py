from sqlalchemy import text


def test_import_saves_drafts_and_deduplicates_by_parent(catalog_client):
    client, connection = catalog_client
    organization_id = connection.scalar(
        text("INSERT INTO organizations (name) VALUES ('Organização sintética') RETURNING id")
    )
    base = f"/organizations/{organization_id}"
    data = {
        "accounts": ["Unidade sintética"],
        "categories": [
            {"name": "Categoria A", "subcategories": ["Cadastro comum"]},
            {"name": "Categoria B", "subcategories": ["Cadastro comum"]},
        ],
        "cost_centers": ["Centro sintético"],
    }

    first = client.post(f"{base}/catalog-imports", json=data)
    assert first.status_code == 201
    assert first.json() == {"accounts": 1, "categories": 2, "subcategories": 2, "cost_centers": 1}
    second = client.post(f"{base}/catalog-imports", json=data)
    assert second.json() == {"accounts": 0, "categories": 0, "subcategories": 0, "cost_centers": 0}

    account = client.get(f"{base}/bank-accounts").json()[0]
    assert account["label"] == "Unidade sintética"
    assert account["bank_code"] is None
    assert account["active"] is False
    categories = client.get(f"{base}/categories").json()
    assert all(not category["active"] and category["kind"] is None for category in categories)
    subs = client.get(f"{base}/subcategories").json()
    assert {item["category_id"] for item in subs} == {item["id"] for item in categories}

    completed = client.put(
        f"{base}/categories/{categories[0]['id']}",
        json={"name": categories[0]["name"], "kind": "EXPENSE"},
    )
    assert completed.status_code == 200
    assert completed.json()["code"] == categories[0]["code"]

    account_updated = client.put(
        f"{base}/bank-accounts/{account['id']}",
        json={
            "label": "Unidade revisada",
            "bank_code": "001",
            "branch": "0001",
            "account_number": "12345678",
            "holder_document": "12.345.678/0001-00",
            "holder_name": "Titular sintético",
        },
    )
    assert account_updated.status_code == 200
    stored = client.get(f"{base}/bank-accounts/{account['id']}").json()
    assert stored["label"] == "Unidade revisada"
    assert stored["holder_name"] == "Titular sintético"
    assert stored["holder_document"] == "12345678000100"
    assert stored["account_number"] == "12345678"
    assert stored["account_number_masked"] == "**5678"
