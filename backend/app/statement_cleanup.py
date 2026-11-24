"""Retirada explícita de lotes de teste, com cópia integral na auditoria."""

import json
from hashlib import sha256
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.catalog import lock_organization
from app.statements import actor

router = APIRouter(prefix="/organizations/{organization_id}/statement-cleanup", tags=["Extratos"])

# Ordem de inserção respeita as chaves estrangeiras. Nunca inclui cadastros ou previsões.
TABLES = {
    "import_files": "id=:file",
    "statement_contents": "import_file_id=:file",
    "bank_transactions": "import_file_id=:file",
    "statement_rows": "import_file_id=:file",
    "transaction_identifications": "transaction_id IN (SELECT id FROM bank_transactions WHERE import_file_id=:file)",
    "transaction_suggestions": "transaction_id IN (SELECT id FROM bank_transactions WHERE import_file_id=:file)",
}


class Removal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: UUID
    token: str = Field(min_length=64, max_length=64)


def snapshot(connection, organization_id, file_id):
    params = {"org": organization_id, "file": file_id}
    info = (
        connection.execute(
            text("""
        SELECT f.file_name, a.label AS account_label, f.period_start, f.period_end
        FROM import_files f JOIN bank_accounts a ON a.id=f.bank_account_id
        WHERE f.id=:file AND f.organization_id=:org
    """),
            params,
        )
        .mappings()
        .one_or_none()
    )
    if info is None:
        raise HTTPException(404, "Extrato não encontrado nesta organização.")
    linked = connection.scalar(
        text("""
        SELECT count(*) FROM entry_settlements s JOIN bank_transactions t ON t.id=s.transaction_id
        WHERE t.import_file_id=:file
    """),
        params,
    )
    shared = connection.scalar(
        text("""
        SELECT count(*) FROM statement_rows r JOIN bank_transactions t ON t.id=r.transaction_id
        WHERE t.import_file_id=:file AND r.import_file_id<>:file
    """),
        params,
    )
    if linked or shared:
        raise HTTPException(
            409,
            "Este extrato possui baixas de lançamentos previstos ou movimentos compartilhados com outro extrato. A retirada foi bloqueada para preservar esses vínculos.",
        )
    data = {}
    for table, scope in TABLES.items():
        data[table] = (
            connection.execute(
                text(f"SELECT to_jsonb(r)::text AS data FROM {table} r WHERE {scope}"), params
            )
            .scalars()
            .all()
        )
        data[table].sort()
    token = sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    return {
        **dict(info),
        "file_id": str(file_id),
        "token": token,
        "movements": len(data["bank_transactions"]),
        "identifications": len(data["transaction_identifications"]),
        "suggestions": len(data["transaction_suggestions"]),
    }, data


@router.get("/{file_id}/preview")
def preview(organization_id: UUID, file_id: UUID, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        summary, _ = snapshot(connection, organization_id, file_id)
        return summary


@router.post("")
def remove(organization_id: UUID, payload: Removal, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        # A proteção histórica só é suspensa nas tabelas explícitas e dentro desta
        # transação exclusiva. Qualquer falha reverte cópia, exclusão e DDL juntos.
        connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        tables = ", ".join(TABLES)
        connection.execute(text(f"LOCK TABLE {tables}, entry_settlements IN ACCESS EXCLUSIVE MODE"))
        summary, data = snapshot(connection, organization_id, payload.file_id)
        if summary["token"] != payload.token:
            raise HTTPException(409, "O lote mudou. Confira a prévia novamente.")
        removal_id = connection.scalar(
            text("""
            INSERT INTO audit_events(organization_id, actor_id, entity_type, entity_id,
                action, old_json, new_json)
            VALUES (:org, :actor, 'import_files', :file, 'test_statement_removal',
                CAST(:backup AS jsonb), CAST(:summary AS jsonb)) RETURNING id
        """),
            {
                "org": organization_id,
                "actor": actor(connection),
                "file": payload.file_id,
                "backup": json.dumps(data),
                "summary": json.dumps(summary, default=str),
            },
        )
        for table in TABLES:
            connection.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER preserve_history"))
        for table in reversed(TABLES):
            connection.execute(
                text(f"DELETE FROM {table} WHERE {TABLES[table]}"), {"file": payload.file_id}
            )
        for table in TABLES:
            connection.execute(text(f"ALTER TABLE {table} ENABLE TRIGGER preserve_history"))
        return {"removed": summary["movements"], "removal_id": str(removal_id)}


@router.get("")
def removals(organization_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        return [
            dict(row)
            for row in connection.execute(
                text("""
            SELECT e.id, e.new_json AS summary, e.created_at FROM audit_events e
            WHERE e.organization_id=:org AND e.action='test_statement_removal'
            AND NOT EXISTS (SELECT 1 FROM audit_events r WHERE r.entity_id=e.id
                AND r.organization_id=:org AND r.action='restore_test_statement')
            ORDER BY e.created_at DESC LIMIT 100
        """),
                {"org": organization_id},
            ).mappings()
        ]


@router.post("/{removal_id}/restore")
def restore(organization_id: UUID, removal_id: UUID, request: Request):
    try:
        with request.app.state.database.begin() as connection:
            lock_organization(connection, organization_id)
            backup = (
                connection.execute(
                    text("""
                SELECT old_json, new_json FROM audit_events e WHERE id=:id
                AND organization_id=:org AND action='test_statement_removal'
                AND NOT EXISTS (SELECT 1 FROM audit_events r WHERE r.entity_id=e.id
                    AND r.action='restore_test_statement' AND r.organization_id=:org)
            """),
                    {"id": removal_id, "org": organization_id},
                )
                .mappings()
                .one_or_none()
            )
            if backup is None:
                raise HTTPException(404, "Cópia não encontrada ou já restaurada.")
            for table in TABLES:
                connection.execute(
                    text(
                        f"INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table}, CAST(:rows AS jsonb))"
                    ),
                    {"rows": "[" + ",".join(backup["old_json"][table]) + "]"},
                )
            connection.execute(
                text("""
                INSERT INTO audit_events(organization_id, actor_id, entity_type, entity_id, action)
                VALUES (:org, :actor, 'audit_events', :id, 'restore_test_statement')
            """),
                {"org": organization_id, "actor": actor(connection), "id": removal_id},
            )
            return {"restored": backup["new_json"]["movements"]}
    except IntegrityError as error:
        raise HTTPException(
            409,
            "A restauração conflita com uma reimportação ou alteração posterior. Nenhum dado foi restaurado parcialmente.",
        ) from error
