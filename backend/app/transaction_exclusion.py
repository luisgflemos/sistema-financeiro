"""Seleção congelada, prévia e exclusão lógica auditada de movimentos importados."""

import json
from hashlib import sha256
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.statements import actor

router = APIRouter(
    prefix="/organizations/{organization_id}/transaction-exclusions", tags=["Transações"]
)


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[UUID] = Field(min_length=1, max_length=100000)


class Exclusion(Selection):
    token: str = Field(min_length=64, max_length=64)


def snapshot(connection, org, ids):
    ids = sorted(set(ids))
    rows = (
        connection.execute(
            text("""
        SELECT t.id,t.posted_on,t.amount,t.direction,t.import_file_id,a.label AS account_label,
            (SELECT max(i.version) FROM transaction_identifications i WHERE i.transaction_id=t.id) AS version,
            (SELECT count(*) FROM entry_settlements s WHERE s.transaction_id=t.id) AS settlements,
            (SELECT count(*) FROM statement_rows r WHERE r.transaction_id=t.id
                AND r.import_file_id<>t.import_file_id AND EXISTS(
                    SELECT 1 FROM import_files linked JOIN import_files original ON original.id=t.import_file_id
                    WHERE linked.id=r.import_file_id AND linked.sha256<>original.sha256
                )) AS other_statements
        FROM active_bank_transactions t JOIN bank_accounts a ON a.id=t.account_id
        WHERE a.organization_id=:org AND t.id=ANY(CAST(:ids AS uuid[])) ORDER BY t.id
    """),
            {"org": org, "ids": ids},
        )
        .mappings()
        .all()
    )
    if len(rows) != len(ids):
        raise HTTPException(
            409,
            "A seleção mudou ou contém registros indisponíveis nesta organização. Atualize a lista.",
        )
    blocked = sum(bool(r["settlements"] or r["other_statements"]) for r in rows)
    summary = {
        "count": len(rows),
        "blocked": blocked,
        "identified": sum(bool(r["version"]) for r in rows),
        "first_date": min(r["posted_on"] for r in rows),
        "last_date": max(r["posted_on"] for r in rows),
        "accounts": sorted({r["account_label"] for r in rows}),
        "credits": f"{sum(r['amount'] for r in rows if r['direction'] == 'CREDIT'):.2f}",
        "debits": f"{sum(r['amount'] for r in rows if r['direction'] == 'DEBIT'):.2f}",
    }
    summary["token"] = sha256(
        json.dumps([dict(r) for r in rows], default=str, sort_keys=True).encode()
    ).hexdigest()
    return summary


@router.post("/preview")
def preview(organization_id: UUID, payload: Selection, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        return snapshot(connection, organization_id, payload.ids)


@router.post("")
def exclude(organization_id: UUID, payload: Exclusion, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        summary = snapshot(connection, organization_id, payload.ids)
        if summary["token"] != payload.token:
            raise HTTPException(409, "A seleção mudou. Confira a prévia novamente.")
        if summary["blocked"]:
            raise HTTPException(
                409,
                "Existem registros com histórico de baixa ou compartilhados com outro extrato. Nenhum registro foi excluído. Revise a seleção; o histórico de baixa permanece protegido mesmo após um estorno.",
            )
        batch, user = uuid4(), actor(connection)
        connection.execute(
            text("""
            INSERT INTO transaction_exclusions(transaction_id,organization_id,actor_id,batch_id)
            SELECT id,:org,:actor,:batch FROM active_bank_transactions
            WHERE id=ANY(CAST(:ids AS uuid[]))
        """),
            {"ids": list(set(payload.ids)), "org": organization_id, "actor": user, "batch": batch},
        )
        connection.execute(
            text("""
            INSERT INTO audit_events(organization_id,actor_id,entity_type,entity_id,action,new_json)
            VALUES (:org,:actor,'transaction_exclusions',:batch,'exclude_movements',CAST(:data AS jsonb))
        """),
            {
                "org": organization_id,
                "actor": user,
                "batch": batch,
                "data": json.dumps({**summary, "ids": [str(i) for i in payload.ids]}, default=str),
            },
        )
        return {"removed": summary["count"]}
