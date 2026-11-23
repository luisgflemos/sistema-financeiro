import pytest
from sqlalchemy import text


@pytest.fixture
def organizations(catalog_client):
    _, connection = catalog_client
    insert = text("INSERT INTO organizations (name) VALUES ('Sintética') RETURNING id")
    first = connection.scalar(insert)
    second = connection.scalar(insert)
    return f"/organizations/{first}", f"/organizations/{second}"


@pytest.mark.parametrize(
    ("path", "entity", "payload", "change"),
    [
        (
            "categories",
            "categories",
            {"name": "Receita", "kind": "REVENUE"},
            {"description": "Receitas da operação"},
        ),
        (
            "cost-centers",
            "cost_centers",
            {"name": "Unidade sintética"},
            {"name": "Unidade revisada"},
        ),
        (
            "parties",
            "parties",
            {"display_name": "Contraparte sintética", "type": "CUSTOMER"},
            {"type": "BOTH", "contact_email": "teste@example.test"},
        ),
    ],
)
def test_catalog_lifecycle(catalog_client, organizations, path, entity, payload, change):
    client, connection = catalog_client
    first, other = organizations
    endpoint = f"{first}/{path}"
    response = client.post(endpoint, json=payload)
    assert response.status_code == 201
    record_id = response.json()["id"]
    url = f"{endpoint}/{record_id}"
    assert client.get(f"{other}/{path}/{record_id}").status_code == 404
    assert client.get(url).json()["active"] is True
    updated = client.put(url, json={**payload, **change})
    assert updated.status_code == 200
    assert {key: updated.json()[key] for key in change} == change
    assert client.delete(url).status_code == 204
    assert client.delete(url).status_code == 204
    assert client.get(endpoint, params={"active": True}).json() == []
    assert client.get(endpoint, params={"active": False}).json()[0]["id"] == record_id

    audit = connection.execute(
        text(
            "SELECT action, new_json FROM audit_events "
            "WHERE entity_type = :kind AND entity_id = :id"
        ),
        {"kind": entity, "id": record_id},
    ).all()
    assert sorted(event.action for event in audit) == ["create", "deactivate", "update"]
    if entity == "parties":
        assert all("contact_email" not in event.new_json for event in audit)


def test_subcategory_scope_and_validity(catalog_client, organizations):
    client, _ = catalog_client
    first, other = organizations
    category = {"name": "Despesa", "kind": "EXPENSE"}
    invalid_period = {**category, "valid_from": "2026-02-01", "valid_to": "2026-01-01"}
    assert client.post(f"{first}/categories", json=invalid_period).status_code == 422
    created_category = client.post(f"{first}/categories", json=category)
    assert created_category.status_code == 201
    assert client.post(f"{first}/categories", json={**category, "code": "manual"}).status_code == 422
    payload = {
        "name": "Despesa mensal",
        "category_id": created_category.json()["id"],
    }

    assert client.post(f"{other}/subcategories", json=payload).status_code == 422
    created = client.post(f"{first}/subcategories", json=payload)
    assert created.status_code == 201
    assert client.post(f"{first}/subcategories", json={**payload, "code": "manual"}).status_code == 422
    record_id = created.json()["id"]
    url = f"{first}/subcategories/{record_id}"
    assert client.get(f"{other}/subcategories/{record_id}").status_code == 404
    assert client.get(f"{other}/subcategories").json() == []
    assert client.put(url, json={**payload, "name": "Mensal revisada"}).status_code == 200
    assert client.delete(url).status_code == 204
    assert client.get(url).json()["active"] is False


def test_cost_center_rejects_cycles_and_foreign_parents(catalog_client, organizations):
    client, _ = catalog_client
    first, other = organizations
    endpoint = f"{first}/cost-centers"
    parent = {"name": "Superior"}
    response = client.post(endpoint, json=parent)
    assert response.status_code == 201
    parent_id = response.json()["id"]
    child = {"name": "Subordinado", "parent_id": parent_id}
    assert client.post(f"{other}/cost-centers", json=child).status_code == 422
    created_child = client.post(endpoint, json=child)
    assert created_child.status_code == 201
    invalid = {**parent, "parent_id": created_child.json()["id"]}
    assert client.put(f"{endpoint}/{parent_id}", json=invalid).status_code == 422
    assert client.get(f"{endpoint}/{parent_id}").json()["parent_id"] is None


def test_openapi_lists_all_catalogs(catalog_client):
    client, _ = catalog_client
    paths = client.get("/openapi.json").json()["paths"]
    for name in ("bank-accounts", "categories", "subcategories", "cost-centers", "parties"):
        base = f"/organizations/{{organization_id}}/{name}"
        assert set(paths[base]) == {"get", "post"}
