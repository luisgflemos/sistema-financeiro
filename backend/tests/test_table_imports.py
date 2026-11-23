import base64
import csv
import io

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import text

from app.table_imports import FIELDS


@pytest.fixture
def import_endpoint(catalog_client):
    client, connection = catalog_client
    organization = connection.scalar(
        text("INSERT INTO organizations (name) VALUES ('Importação sintética') RETURNING id")
    )
    return client, connection, f"/organizations/{organization}/table-imports"


def csv_source(headers, rows):
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(headers)
    writer.writerows(rows)
    return {
        "file_name": "sintetico.csv",
        "content": base64.b64encode(output.getvalue().encode("utf-8-sig")).decode(),
    }


@pytest.mark.parametrize(
    ("kind", "rows", "table"),
    [
        (
            "parties",
            [["Cliente sintético", "Cliente", "12.345.678/0001-00"]],
            "parties",
        ),
        (
            "bank-accounts",
            [["Conta sintética", "033", "0001", "00123456"]],
            "bank_accounts",
        ),
        ("cost-centers", [["Centro sintético"]], "cost_centers"),
        ("categories", [["Categoria sintética", "Despesa"]], "categories"),
    ],
)
def test_preview_validate_commit_and_retry(import_endpoint, kind, rows, table):
    client, connection, endpoint = import_endpoint
    headers = [label for _, label, _, _ in FIELDS[kind]][: len(rows[0])]
    source = csv_source(headers, rows)
    preview = client.post(f"{endpoint}/{kind}/preview", json=source)
    assert preview.status_code == 200
    mapped = {**source, "mapping": preview.json()["mapping"]}
    initial = connection.scalar(text(f"SELECT count(*) FROM {table}"))
    validation = client.post(f"{endpoint}/{kind}/validate", json=mapped)
    assert validation.status_code == 200
    assert validation.json()["errors"] == 0
    assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == initial

    committed = client.post(f"{endpoint}/{kind}/commit", json=mapped)
    assert committed.status_code == 200
    assert committed.json()["new"] == 1
    assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == initial + 1
    retry = client.post(f"{endpoint}/{kind}/commit", json=mapped)
    assert retry.json()["new"] == 0
    assert retry.json()["duplicates"] == 1


def test_errors_roll_back_whole_import(import_endpoint):
    client, connection, endpoint = import_endpoint
    source = csv_source(
        ["Nome", "Tipo"],
        [["Cliente sintético", "Cliente"], ["Outro cliente", "Inválido"]],
    )
    mapped = {**source, "mapping": {"display_name": 0, "type": 1}}
    initial = connection.scalar(text("SELECT count(*) FROM parties"))
    preview = client.post(f"{endpoint}/parties/validate", json=mapped)
    assert preview.json()["errors"] == 1
    assert preview.json()["rows"][1]["row"] == 3
    assert client.post(f"{endpoint}/parties/commit", json=mapped).status_code == 422
    assert connection.scalar(text("SELECT count(*) FROM parties")) == initial


def test_xlsx_custom_mapping_and_subcategory_link(import_endpoint):
    client, connection, endpoint = import_endpoint
    book = Workbook()
    sheet = book.active
    sheet.title = "Dados"
    sheet.append(["Exportação sintética"])
    sheet.append(["Grupo ERP", "Natureza ERP", "Detalhe ERP"])
    sheet.append(["Grupo sintético", "Receita", "Detalhe sintético"])
    output = io.BytesIO()
    book.save(output)
    source = {
        "file_name": "sintetico.xlsx",
        "header_row": 2,
        "sheet": "Dados",
        "content": base64.b64encode(output.getvalue()).decode(),
    }
    preview = client.post(f"{endpoint}/categories/preview", json=source)
    assert preview.json()["total"] == 1
    mapped = {**source, "mapping": {"name": 0, "kind": 1, "sub_name": 2}}
    assert client.post(f"{endpoint}/categories/commit", json=mapped).json()["errors"] == 0
    assert (
        connection.scalar(
            text(
                "SELECT count(*) FROM subcategories AS sub JOIN categories AS parent "
                "ON parent.id = sub.category_id WHERE parent.name = 'Grupo sintético' "
                "AND sub.name = 'Detalhe sintético'"
            )
        )
        == 1
    )


def test_templates_are_readable(import_endpoint):
    client, _, endpoint = import_endpoint
    for kind in FIELDS:
        response = client.get(f"{endpoint}/{kind}/template?format=xlsx")
        assert response.status_code == 200
        book = load_workbook(io.BytesIO(response.content), read_only=True)
        assert book.active["A1"].value == FIELDS[kind][0][1]
        book.close()
        response = client.get(f"{endpoint}/{kind}/template?format=csv")
        assert response.content.decode("utf-8-sig").split(";")[0] == FIELDS[kind][0][1]


@pytest.mark.parametrize("active", ["Sim", "Não"])
def test_fixed_values_apply_to_every_row(import_endpoint, active):
    client, connection, endpoint = import_endpoint
    source = csv_source(["Nome ERP"], [["Cliente fixo A"], ["Cliente fixo B"]])
    mapped = {
        **source,
        "mapping": {"display_name": 0},
        "constants": {"type": "Cliente", "active": active},
    }
    validation = client.post(f"{endpoint}/parties/validate", json=mapped)
    assert validation.json()["new"] == 2
    assert (
        connection.scalar(
            text("SELECT count(*) FROM parties WHERE display_name LIKE 'Cliente fixo%'")
        )
        == 0
    )
    assert client.post(f"{endpoint}/parties/commit", json=mapped).json()["new"] == 2
    rows = connection.execute(
        text("SELECT type, active FROM parties WHERE display_name LIKE 'Cliente fixo%'")
    ).all()
    assert rows == [("CUSTOMER", active == "Sim")] * 2
    assert client.post(f"{endpoint}/parties/commit", json=mapped).json()["duplicates"] == 2


def test_reject_conflicting_or_invalid_fixed_values(import_endpoint):
    client, _, endpoint = import_endpoint
    source = csv_source(["Nome", "Tipo"], [["Cliente teste", "Cliente"]])
    mapped = {**source, "mapping": {"display_name": 0, "type": 1}}
    for constants in [{"type": "Cliente"}, {"display_name": "Sobrescrever"}]:
        response = client.post(
            f"{endpoint}/parties/validate", json={**mapped, "constants": constants}
        )
        assert response.status_code == 422
    mapped["mapping"] = {"display_name": 0}
    mapped["constants"] = {"type": "Inválido"}
    assert client.post(f"{endpoint}/parties/validate", json=mapped).json()["errors"] == 1
    assert client.post(f"{endpoint}/parties/commit", json=mapped).status_code == 422


def test_preview_exposes_explanation_and_candidates(import_endpoint):
    client, _, endpoint = import_endpoint
    source = csv_source(["Nome Fantasia", "Telefone", "Celular"], [["Teste", "", ""]])
    result = client.post(f"{endpoint}/parties/preview", json=source)
    assert result.status_code == 200
    data = result.json()
    assert data["mapping"]["display_name"] == 0
    assert "display_name" in data["suggestions"]
    assert len(data["ambiguities"]["contact_phone"]) == 2
