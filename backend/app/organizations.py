from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import Connection, text

router = APIRouter(prefix="/organizations", tags=["Organizações"])


class OrganizationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class Organization(BaseModel):
    id: UUID
    name: str


def insert_organization(connection: Connection, name: str) -> Organization:
    row = (
        connection.execute(
            text("INSERT INTO organizations (name) VALUES (:name) RETURNING id, name"),
            {"name": name},
        )
        .mappings()
        .one()
    )
    return Organization.model_validate(row)


@router.get("")
def list_organizations(request: Request) -> list[Organization]:
    with request.app.state.database.connect() as connection:
        rows = connection.execute(text("SELECT id, name FROM organizations ORDER BY name, id"))
        return [Organization.model_validate(row) for row in rows.mappings()]


@router.post("", status_code=201)
def create_organization(payload: OrganizationInput, request: Request) -> Organization:
    with request.app.state.database.begin() as connection:
        return insert_organization(connection, payload.name)
