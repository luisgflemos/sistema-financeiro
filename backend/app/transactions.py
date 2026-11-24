"""Identificações gerenciais versionadas, separadas do registro bancário."""

import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.statements import actor

router = APIRouter(prefix="/organizations/{organization_id}/transactions", tags=["Transações"])
IDENT_FIELDS = (
    "party_id",
    "category_id",
    "subcategory_id",
    "cost_center_id",
    "movement_kind",
)
LATEST = """
    LEFT JOIN LATERAL (
        SELECT * FROM transaction_identifications i
        WHERE i.transaction_id = t.id ORDER BY version DESC LIMIT 1
    ) i ON true
"""


class Identification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    party_id: UUID | None = None
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    cost_center_id: UUID | None = None
    movement_kind: Literal["NORMAL", "AUTOMATIC_PROCESS", "INTERNAL_TRANSFER"] = "NORMAL"
    notes: str | None = Field(default=None, max_length=4000)
    expected_version: int = Field(default=0, ge=0)
    suggestion_id: UUID | None = None


def transaction(connection, organization_id, transaction_id):
    result = (
        connection.execute(
            text(
                """
        SELECT t.*, i.version, i.party_id, i.category_id, i.subcategory_id,
            i.cost_center_id, i.movement_kind, i.notes, i.method
        FROM bank_transactions t JOIN bank_accounts a ON a.id = t.account_id
    """
                + LATEST
                + """
        WHERE t.id = :id AND a.organization_id = :org
    """
            ),
            {"id": transaction_id, "org": organization_id},
        )
        .mappings()
        .one_or_none()
    )
    if result is None:
        raise HTTPException(404, "Movimento não encontrado.")
    return dict(result)


def normalize_identification(payload):
    if payload.movement_kind == "AUTOMATIC_PROCESS":
        return payload.model_copy(update={key: None for key in IDENT_FIELDS[:4]})
    return payload


def validate_identification(
    connection, organization_id, payload, require_complete=True, direction=None
):
    payload = normalize_identification(payload)
    values = payload.model_dump()
    if (
        require_complete
        and payload.movement_kind == "NORMAL"
        and any(not values[key] for key in ("category_id", "subcategory_id", "cost_center_id"))
    ):
        raise HTTPException(
            422,
            "Informe classificação, subclassificação e centro de custos.",
        )
    checks = (
        ("party_id", "parties"),
        ("category_id", "categories"),
        ("cost_center_id", "cost_centers"),
    )
    for field, table in checks:
        if values[field] and not connection.scalar(
            text(f"SELECT 1 FROM {table} WHERE id = :id AND organization_id = :org AND active"),
            {"id": values[field], "org": organization_id},
        ):
            raise HTTPException(422, "Selecione cadastros ativos desta organização.")
    if values["category_id"]:
        expected_kind = (
            "NEUTRAL"
            if payload.movement_kind == "INTERNAL_TRANSFER"
            else "REVENUE"
            if direction == "CREDIT"
            else "EXPENSE"
            if direction == "DEBIT"
            else None
        )
        if (
            expected_kind
            and connection.scalar(
                text("SELECT kind FROM categories WHERE id=:id"), {"id": values["category_id"]}
            )
            != expected_kind
        ):
            label = {"NEUTRAL": "neutra", "REVENUE": "de receita", "EXPENSE": "de despesa"}[
                expected_kind
            ]
            raise HTTPException(
                422, "Selecione uma classificação " + label + " para este tratamento."
            )
    if values["subcategory_id"] and not connection.scalar(
        text("""
        SELECT 1 FROM subcategories s JOIN categories c ON c.id = s.category_id
        WHERE s.id = :id AND s.category_id = :category AND c.organization_id = :org
            AND s.active AND c.active
    """),
        {
            "id": values["subcategory_id"],
            "category": values["category_id"],
            "org": organization_id,
        },
    ):
        raise HTTPException(422, "A subclassificação não pertence à classificação escolhida.")
    return values


def save_identification(connection, organization_id, record, payload, method="OPERATOR"):
    payload = normalize_identification(payload)
    values = validate_identification(
        connection, organization_id, payload, direction=record["direction"]
    )
    version = record.get("version") or 0
    if version != payload.expected_version:
        raise HTTPException(
            409, "O movimento foi identificado por outro operador. Atualize a lista."
        )
    if payload.suggestion_id:
        suggestion = connection.execute(
            text("""
            SELECT payload FROM transaction_suggestions
            WHERE id = :id AND transaction_id = :tx AND organization_id = :org
        """),
            {"id": payload.suggestion_id, "tx": record["id"], "org": organization_id},
        ).scalar()
        if not suggestion:
            raise HTTPException(422, "Sugestão inválida.")
        if all(
            str(suggestion.get(key) or "") == str(values.get(key) or "") for key in IDENT_FIELDS
        ):
            method = "AI_CONFIRMED"
    actor_id = actor(connection)
    current = connection.scalar(
        text("""
        INSERT INTO transaction_identifications(
            transaction_id, organization_id, version, party_id, category_id, subcategory_id,
            cost_center_id, movement_kind, notes, method, actor_id
        ) VALUES (:tx, :org, :version, :party_id, :category_id, :subcategory_id,
            :cost_center_id, :movement_kind, :notes, :method, :actor) RETURNING id
    """),
        {
            **{key: values[key] for key in (*IDENT_FIELDS, "notes")},
            "tx": record["id"],
            "org": organization_id,
            "version": version + 1,
            "method": method,
            "actor": actor_id,
        },
    )
    connection.execute(
        text("""
        INSERT INTO audit_events(organization_id, actor_id, entity_type, entity_id, action, new_json)
        VALUES (:org, :actor, 'transaction_identifications', :id, 'identify', CAST(:data AS jsonb))
    """),
        {
            "org": organization_id,
            "actor": actor_id,
            "id": current,
            "data": json.dumps(
                {
                    "transaction_id": str(record["id"]),
                    "version": version + 1,
                    "method": method,
                }
            ),
        },
    )
    return {"version": version + 1}


@router.put("/{transaction_id}/identification")
def identify(
    organization_id: UUID,
    transaction_id: UUID,
    payload: Identification,
    request: Request,
):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        record = transaction(connection, organization_id, transaction_id)
        from app.planning import ACTIVE_LINK

        if connection.execute(
            text(ACTIVE_LINK), {"org": organization_id, "tx": transaction_id}
        ).first():
            raise HTTPException(
                409, "Desvincule o lançamento antes de alterar a identificação diretamente."
            )
        return save_identification(connection, organization_id, record, payload)


@router.get("")
def list_transactions(
    organization_id: UUID,
    request: Request,
    account_id: UUID | None = None,
    statement_id: UUID | None = None,
    state: Literal["all", "pending", "identified", "suggested"] = "pending",
    query: str = Query(default="", max_length=200),
    start: str | None = None,
    end: str | None = None,
    direction: Literal["CREDIT", "DEBIT"] | None = None,
    page: int = Query(default=1, ge=1),
):
    from datetime import date

    try:
        start_date = date.fromisoformat(start) if start else None
        end_date = date.fromisoformat(end) if end else None
    except ValueError as error:
        raise HTTPException(422, "Data inválida.") from error
    if start_date and end_date and end_date < start_date:
        raise HTTPException(422, "O fim do período deve ser igual ou posterior ao início.")
    params = {
        "org": organization_id,
        "account": account_id,
        "statement": statement_id,
        "query": "%" + query.strip() + "%",
        "start": start_date,
        "end": end_date,
        "direction": direction,
        "offset": (page - 1) * 100,
    }
    conditions = """
        WHERE a.organization_id = :org
        AND (CAST(:account AS uuid) IS NULL OR a.id = :account)
        AND (CAST(:statement AS uuid) IS NULL OR t.import_file_id = :statement)
        AND (CAST(:start AS date) IS NULL OR t.posted_on >= :start)
        AND (CAST(:end AS date) IS NULL OR t.posted_on <= :end)
        AND (CAST(:direction AS text) IS NULL OR t.direction = :direction)
        AND (t.raw_description ILIKE :query OR COALESCE(t.raw_counterparty, '') ILIKE :query)
    """
    if state == "pending":
        conditions += " AND i.id IS NULL AND t.editable"
    elif state == "identified":
        conditions += " AND i.id IS NOT NULL"
    elif state == "suggested":
        conditions += " AND i.id IS NULL AND s.id IS NOT NULL"
    source_table = "(SELECT b.*, TRUE AS editable FROM bank_transactions b)"
    if statement_id:
        # Visão do arquivo: uma representação por linha, ligada ao movimento canônico quando conhecido.
        source_table = """
            (SELECT COALESCE(b.id, r.id) AS id, f.bank_account_id AS account_id,
                r.import_file_id, r.source_row,
                CAST(r.original_data->>'posted_on' AS date) AS posted_on,
                r.original_data->>'direction' AS direction,
                CAST(r.original_data->>'amount' AS numeric) AS amount,
                'BRL'::text AS currency, r.original_data->>'description' AS raw_description,
                NULL::text AS raw_counterparty,
                jsonb_build_object(
                    'data', r.original_data->>'posted_on',
                    'historico', r.original_data->>'description',
                    'documento', r.original_data->>'document',
                    'saldo', r.original_data->>'balance'
                ) AS raw_payload,
                r.transaction_id IS NOT NULL AS editable
            FROM statement_rows r JOIN import_files f ON f.id=r.import_file_id
            LEFT JOIN bank_transactions b ON b.id=r.transaction_id
            WHERE r.import_file_id=:statement)
        """
    joins = (
        f"""
        FROM {source_table} t JOIN bank_accounts a ON a.id = t.account_id
    """
        + LATEST
        + """
        LEFT JOIN LATERAL (
            SELECT * FROM transaction_suggestions s WHERE s.transaction_id = t.id
            ORDER BY created_at DESC, id LIMIT 1
        ) s ON true
    """
    )
    with request.app.state.database.connect() as connection:
        if not connection.scalar(
            text("SELECT 1 FROM organizations WHERE id = :org"),
            {"org": organization_id},
        ):
            raise HTTPException(404, "Organização não encontrada.")
        count = connection.scalar(text("SELECT count(*) " + joins + conditions), params)
        rows = connection.execute(
            text(
                """
            SELECT t.id, t.account_id, t.import_file_id, t.source_row, t.editable,
                (SELECT f.file_name FROM import_files f WHERE f.id=t.import_file_id) AS file_name,
                a.label AS account_label, t.posted_on, t.direction,
                t.amount, t.currency, t.raw_description, t.raw_payload,
                COALESCE(i.version, 0) AS version, i.party_id, i.category_id, i.subcategory_id,
                i.cost_center_id, i.movement_kind, i.notes, i.method,
                CASE WHEN NOT t.editable THEN 'duplicate' WHEN i.id IS NOT NULL THEN 'identified'
                    WHEN s.id IS NOT NULL THEN 'suggested' ELSE 'pending' END AS state,
                s.id AS suggestion_id, s.payload AS suggestion, s.reason, s.confidence,
                (SELECT e.description FROM entry_settlements l JOIN planned_entries e ON e.id=l.entry_id
                    WHERE l.transaction_id=t.id AND NOT EXISTS(
                        SELECT 1 FROM settlement_reversals r WHERE r.settlement_id=l.id
                    ) ORDER BY l.created_at DESC LIMIT 1) AS planning_description,
                (SELECT c.name FROM categories c WHERE c.id = i.category_id) AS category_name,
                (SELECT c.name FROM cost_centers c WHERE c.id = i.cost_center_id) AS cost_center_name,
                (SELECT p.display_name FROM parties p WHERE p.id = i.party_id) AS party_name
        """
                + joins
                + conditions
                + " ORDER BY t.posted_on DESC, t.import_file_id, t.source_row LIMIT 100 OFFSET :offset"
            ),
            params,
        ).mappings()
        return {
            "total": count,
            "page": page,
            "rows": [{**dict(row), "amount": f"{row['amount']:.2f}"} for row in rows],
        }
