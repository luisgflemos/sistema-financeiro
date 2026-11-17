from collections.abc import Iterable
from typing import Annotated
from unicodedata import normalize
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import Connection, text

from app.catalog import lock_organization
from app.codes import next_catalog_code

router = APIRouter(
    prefix="/organizations/{organization_id}/catalog-imports",
    tags=["Importação de cadastros"],
)
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]


class CategoryRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Label
    subcategories: list[Label] = Field(max_length=500)


class ImportCatalogs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accounts: list[Label] = Field(max_length=500)
    categories: list[CategoryRow] = Field(max_length=500)
    cost_centers: list[Label] = Field(max_length=500)


def key(value: str) -> str:
    return " ".join(normalize("NFC", value).split()).casefold()


def add_missing(
    connection: Connection,
    organization_id: UUID,
    table: str,
    existing: dict,
    names: Iterable[str],
    parent_id: UUID | None = None,
) -> int:
    if table == "subcategories":
        statement = text(
            "INSERT INTO subcategories (category_id, code, name) "
            "VALUES (:parent, :code, :name) RETURNING id"
        )
    else:
        name_column = "label" if table == "bank_accounts" else "name"
        active = "true" if table == "cost_centers" else "false"
        statement = text(
            f"INSERT INTO {table} (organization_id, code, {name_column}, active) "
            f"VALUES (:org, :code, :name, {active}) RETURNING id"
        )

    inserted = 0
    for name in names:
        normalized = key(name)
        if normalized in existing:
            continue
        code = next_catalog_code(connection, table, parent_id or organization_id)
        existing[normalized] = connection.execute(
            statement, {"org": organization_id, "parent": parent_id, "code": code, "name": name}
        ).scalar_one()
        inserted += 1
    return inserted


@router.post("", status_code=201)
def import_catalogs(
    organization_id: UUID, payload: ImportCatalogs, request: Request
) -> dict[str, int]:
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        params = {"org": organization_id}
        accounts = {
            key(label): item_id
            for item_id, label in connection.execute(
                text(
                    "SELECT id, COALESCE(label, holder_name) FROM bank_accounts "
                    "WHERE organization_id = :org"
                ),
                params,
            )
            if label
        }
        centers = {
            key(name): item_id
            for item_id, name in connection.execute(
                text("SELECT id, name FROM cost_centers WHERE organization_id = :org"), params
            )
        }
        categories = {}
        requested = {key(row.name) for row in payload.categories}
        for item_id, name in connection.execute(
            text("SELECT id, name FROM categories WHERE organization_id = :org"), params
        ):
            normalized = key(name)
            if normalized in categories and normalized in requested:
                raise HTTPException(409, f"Há mais de uma classificação cadastrada como {name}.")
            categories[normalized] = item_id

        counts = {
            "accounts": add_missing(
                connection, organization_id, "bank_accounts", accounts, payload.accounts
            ),
            "cost_centers": add_missing(
                connection, organization_id, "cost_centers", centers, payload.cost_centers
            ),
            "categories": add_missing(
                connection,
                organization_id,
                "categories",
                categories,
                (row.name for row in payload.categories),
            ),
            "subcategories": 0,
        }
        for row in payload.categories:
            parent = categories[key(row.name)]
            children = {
                key(name): item_id
                for item_id, name in connection.execute(
                    text("SELECT id, name FROM subcategories WHERE category_id = :parent"),
                    {"parent": parent},
                )
            }
            counts["subcategories"] += add_missing(
                connection, organization_id, "subcategories", children, row.subcategories, parent
            )
        if any(counts.values()):
            connection.execute(
                text(
                    """
                    INSERT INTO audit_events (organization_id, entity_type, entity_id, action)
                    VALUES (:org, 'catalog_imports', :org, 'import')
                    """
                ),
                params,
            )
        return counts
