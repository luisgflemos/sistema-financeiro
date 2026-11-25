"""Cadastro simples de grupos: nome e clientes existentes, com auditoria."""

import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.codes import next_catalog_code
from app.historical_parser import normalize
from app.statements import actor

router = APIRouter(
    prefix="/organizations/{organization_id}/customer-groups",
    tags=["Grupos de Clientes"],
)


class GroupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    active: bool = True
    member_ids: list[UUID] = Field(default_factory=list, max_length=10000)


def groups(connection, organization_id):
    return [
        dict(r)
        for r in connection.execute(
            text("""
        SELECT g.*, COALESCE((SELECT json_agg(p.id ORDER BY p.display_name,p.id)
           FROM parties p WHERE p.customer_group_id=g.id AND p.organization_id=g.organization_id),'[]'::json) AS member_ids
        FROM customer_groups g WHERE g.organization_id=:org ORDER BY g.name,g.id
    """),
            {"org": organization_id},
        ).mappings()
    ]


def save(connection, organization_id, payload, group_id=None):
    lock_organization(connection, organization_id)
    current = groups(connection, organization_id)
    previous = next((r for r in current if r["id"] == group_id), None)
    if group_id and not previous:
        raise HTTPException(404, "Grupo não encontrado.")
    name = payload.name.strip()
    if not name or any(
        r["id"] != group_id and normalize(r["name"]) == normalize(name) for r in current
    ):
        raise HTTPException(422, "Informe um nome único para o grupo.")
    members = set(payload.member_ids)
    available = {
        r["id"]: dict(r)
        for r in connection.execute(
            text(
                "SELECT id, customer_group_id, type FROM parties WHERE organization_id=:org"
            ),
            {"org": organization_id},
        ).mappings()
    }
    if any(
        i not in available or available[i]["type"] not in ("CUSTOMER", "BOTH")
        for i in members
    ):
        raise HTTPException(422, "Selecione clientes cadastrados nesta organização.")
    if any(available[i]["customer_group_id"] not in (None, group_id) for i in members):
        raise HTTPException(
            409,
            "Um cliente já pertence a outro grupo. Retire-o do grupo anterior antes de vincular.",
        )
    if group_id:
        connection.execute(
            text("UPDATE customer_groups SET name=:name,active=:active WHERE id=:id"),
            {"name": name, "active": payload.active, "id": group_id},
        )
    else:
        group_id = connection.scalar(
            text(
                "INSERT INTO customer_groups(organization_id,code,name,active) VALUES (:org,:code,:name,:active) RETURNING id"
            ),
            {
                "org": organization_id,
                "code": next_catalog_code(
                    connection, "customer_groups", organization_id
                ),
                "name": name,
                "active": payload.active,
            },
        )
    old_members = {
        i for i, r in available.items() if r["customer_group_id"] == group_id
    }
    for member_id in old_members ^ members:
        old_group = available[member_id]["customer_group_id"]
        new_group = group_id if member_id in members else None
        connection.execute(
            text(
                "UPDATE parties SET customer_group_id=:group WHERE id=:id AND organization_id=:org"
            ),
            {"group": new_group, "id": member_id, "org": organization_id},
        )
        connection.execute(
            text(
                "INSERT INTO audit_events(organization_id,actor_id,entity_type,entity_id,action,old_json,new_json) VALUES (:org,:actor,'parties',:id,'set_customer_group',CAST(:old AS jsonb),CAST(:new AS jsonb))"
            ),
            {
                "org": organization_id,
                "actor": actor(connection),
                "id": member_id,
                "old": json.dumps(
                    {"customer_group_id": str(old_group) if old_group else None}
                ),
                "new": json.dumps(
                    {"customer_group_id": str(new_group) if new_group else None}
                ),
            },
        )
    result = next(r for r in groups(connection, organization_id) if r["id"] == group_id)
    connection.execute(
        text(
            "INSERT INTO audit_events(organization_id,actor_id,entity_type,entity_id,action,old_json,new_json) VALUES (:org,:actor,'customer_groups',:id,:action,CAST(:old AS jsonb),CAST(:new AS jsonb))"
        ),
        {
            "org": organization_id,
            "actor": actor(connection),
            "id": group_id,
            "action": "update" if previous else "create",
            "old": json.dumps(previous, default=str) if previous else None,
            "new": json.dumps(result, default=str),
        },
    )
    return result


@router.get("")
def list_groups(organization_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        return groups(connection, organization_id)


@router.post("", status_code=201)
def create_group(organization_id: UUID, payload: GroupInput, request: Request):
    with request.app.state.database.begin() as connection:
        return save(connection, organization_id, payload)


@router.put("/{group_id}")
def update_group(
    organization_id: UUID, group_id: UUID, payload: GroupInput, request: Request
):
    with request.app.state.database.begin() as connection:
        return save(connection, organization_id, payload, group_id)
