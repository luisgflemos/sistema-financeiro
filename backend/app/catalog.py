import json
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

from app.codes import PREFIXES, next_catalog_code


@dataclass(frozen=True)
class Catalog:
    path: str
    table: str
    label: str
    model: type[BaseModel]
    response: type[BaseModel]
    order_by: str = "code"
    scope: str = "organization_id = :org"
    direct_organization: bool = True
    private_fields: frozenset[str] = frozenset()
    validate: Callable[[Connection, UUID, dict, UUID | None], None] | None = None


def lock_organization(connection: Connection, organization_id: UUID) -> None:
    exists = connection.scalar(
        text("SELECT 1 FROM organizations WHERE id = :org FOR UPDATE"),
        {"org": organization_id},
    )
    if not exists:
        raise HTTPException(404, "Organização não encontrada.")


def record_audit(connection, catalog, organization_id, action, current, previous=None):
    def snapshot(values):
        return {key: value for key, value in values.items() if key not in catalog.private_fields}

    current_snapshot = snapshot(current)
    if previous:
        current_snapshot["changed_fields"] = [
            key for key, value in current.items() if previous.get(key) != value
        ]

    connection.execute(
        text(
            """
            INSERT INTO audit_events (
                organization_id, entity_type, entity_id, action, old_json, new_json
            )
            VALUES (:org, :entity, :id, :action, CAST(:old AS jsonb), CAST(:new AS jsonb))
            """
        ),
        {
            "org": organization_id,
            "entity": catalog.table,
            "id": current["id"],
            "action": action,
            "old": json.dumps(snapshot(previous), default=str) if previous else None,
            "new": json.dumps(current_snapshot, default=str),
        },
    )


def catalog_router(catalog: Catalog) -> APIRouter:
    # Identificadores SQL vêm da configuração interna e dos modelos, e os dados são vinculados.
    model = catalog.model
    table = catalog.table
    scope = catalog.scope
    fields = list(model.model_fields)
    insert_fields = [*fields, "organization_id"] if catalog.direct_organization else fields
    columns = ", ".join(insert_fields)
    placeholders = ", ".join(f":{field}" for field in insert_fields)
    updates = ", ".join(f"{field} = :{field}" for field in fields)
    router = APIRouter(
        prefix=f"/organizations/{{organization_id}}/{catalog.path}", tags=[catalog.label]
    )

    def find(connection, organization_id, record_id) -> dict:
        row = (
            connection.execute(
                text(f"SELECT * FROM {table} WHERE id = :id AND ({scope})"),
                {"id": record_id, "org": organization_id},
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise HTTPException(404, "Cadastro não encontrado.")
        return dict(row)

    def save(connection, organization_id, values, previous=None) -> dict:
        record_id = previous["id"] if previous else None
        if table in PREFIXES and values["code"] is None:
            values["code"] = (
                previous["code"]
                if previous
                else next_catalog_code(connection, table, organization_id)
            )
        if catalog.validate:
            catalog.validate(connection, organization_id, values, record_id)
        if previous and all(previous[field] == values[field] for field in fields):
            return previous

        if previous:
            query = f"UPDATE {table} SET {updates} WHERE id = :id RETURNING *"
            params = {**values, "id": record_id}
        else:
            query = f"INSERT INTO {table} ({columns}) VALUES ({placeholders}) RETURNING *"
            params = {**values, "organization_id": organization_id}

        try:
            current = dict(connection.execute(text(query), params).mappings().one())
        except IntegrityError as error:
            if error.orig.sqlstate == "23505":
                raise HTTPException(409, "Já existe um cadastro com esse código.") from error
            raise
        action = "update" if previous else "create"
        record_audit(connection, catalog, organization_id, action, current, previous)
        return current

    @router.get("", response_model=list[catalog.response], name=f"list_{table}")
    def list_records(
        organization_id: UUID, request: Request, active: bool | None = None
    ) -> list[dict]:
        with request.app.state.database.connect() as connection:
            rows = connection.execute(
                text(
                    f"""
                    SELECT * FROM {table} WHERE ({scope})
                        AND (CAST(:active AS boolean) IS NULL OR active = :active)
                    ORDER BY {catalog.order_by}, id
                    """
                ),
                {"org": organization_id, "active": active},
            ).mappings()
            return [dict(row) for row in rows]

    @router.get("/{record_id}", response_model=catalog.response, name=f"get_{table}")
    def get_record(organization_id: UUID, record_id: UUID, request: Request) -> dict:
        with request.app.state.database.connect() as connection:
            return find(connection, organization_id, record_id)

    @router.post("", response_model=catalog.response, status_code=201, name=f"create_{table}")
    def create_record(organization_id: UUID, payload: model, request: Request) -> dict:
        with request.app.state.database.begin() as connection:
            lock_organization(connection, organization_id)
            return save(connection, organization_id, payload.model_dump())

    @router.put("/{record_id}", response_model=catalog.response, name=f"update_{table}")
    def update_record(
        organization_id: UUID, record_id: UUID, payload: model, request: Request
    ) -> dict:
        with request.app.state.database.begin() as connection:
            lock_organization(connection, organization_id)
            previous = find(connection, organization_id, record_id)
            return save(connection, organization_id, payload.model_dump(), previous)

    @router.delete("/{record_id}", status_code=204, name=f"deactivate_{table}")
    def deactivate_record(organization_id: UUID, record_id: UUID, request: Request) -> Response:
        with request.app.state.database.begin() as connection:
            lock_organization(connection, organization_id)
            previous = find(connection, organization_id, record_id)
            if previous["active"]:
                connection.execute(
                    text(f"UPDATE {table} SET active = false WHERE id = :id"), {"id": record_id}
                )
                record_audit(
                    connection,
                    catalog,
                    organization_id,
                    "deactivate",
                    {**previous, "active": False},
                    previous,
                )
        return Response(status_code=204)

    return router
