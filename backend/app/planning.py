"""Planejamento, recorrência e baixas rastreáveis por movimentos do extrato."""

import calendar
import hashlib
import json
import unicodedata
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.statements import actor
from app.transactions import (
    Identification,
    save_identification,
    transaction,
    validate_identification,
)

router = APIRouter(prefix="/organizations/{organization_id}/planned-entries", tags=["Lançamentos"])

SUMMARY = """
    SELECT e.*, COALESCE(s.paid, 0) AS paid, COALESCE(s.finished, false) AS finished,
        p.display_name AS party_name, a.label AS account_label,
        c.name AS category_name, sub.name AS subcategory_name, cc.name AS cost_center_name
    FROM planned_entries e
    LEFT JOIN LATERAL (
        SELECT sum(l.amount) AS paid, bool_or(l.finish) AS finished
        FROM entry_settlements l WHERE l.entry_id=e.id
        AND NOT EXISTS(SELECT 1 FROM settlement_reversals r WHERE r.settlement_id=l.id)
    ) s ON true
    LEFT JOIN parties p ON p.id=e.party_id
    LEFT JOIN bank_accounts a ON a.id=e.account_id
    JOIN categories c ON c.id=e.category_id
    JOIN subcategories sub ON sub.id=e.subcategory_id
    JOIN cost_centers cc ON cc.id=e.cost_center_id
"""
ACTIVE_LINK = """
    SELECT l.* FROM entry_settlements l JOIN planned_entries e ON e.id=l.entry_id
    WHERE l.transaction_id=:tx AND e.organization_id=:org
    AND NOT EXISTS(SELECT 1 FROM settlement_reversals r WHERE r.settlement_id=l.id)
"""


class EntryFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(min_length=1, max_length=300)
    due_on: date
    direction: Literal["CREDIT", "DEBIT"]
    expected_amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    account_id: UUID | None = None
    category_id: UUID
    subcategory_id: UUID
    cost_center_id: UUID
    party_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=4000)


class NewEntry(EntryFields):
    request_key: UUID
    frequency: Literal["ONCE", "WEEKLY", "MONTHLY", "YEARLY"] = "ONCE"
    occurrences: int = Field(default=1, ge=1, le=120)


class EditEntry(EntryFields):
    expected_version: int = Field(ge=1)


class Version(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)


class Settlement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transaction_id: UUID
    expected_transaction_version: int = Field(default=0, ge=0)
    expected_entry_version: int = Field(ge=1)
    finish: bool = False
    confirm_difference: bool = False
    notes: str | None = Field(default=None, max_length=4000)


def audit(connection, org, entity, identifier, action, old=None, new=None):
    connection.execute(
        text("""INSERT INTO audit_events(organization_id,actor_id,entity_type,entity_id,action,old_json,new_json)
        VALUES(:org,:actor,:entity,:id,:action,CAST(:old AS jsonb),CAST(:new AS jsonb))"""),
        {
            "org": org,
            "actor": actor(connection),
            "entity": entity,
            "id": identifier,
            "action": action,
            "old": json.dumps(old, default=str) if old is not None else None,
            "new": json.dumps(new, default=str) if new is not None else None,
        },
    )


def present(row):
    result = dict(row)
    expected, paid = row["expected_amount"], row["paid"]
    closed = row["cancelled"] or row["finished"] or paid >= expected
    result["state"] = (
        "cancelled" if row["cancelled"] else "realized" if closed else "partial" if paid else "open"
    )
    result["outstanding"] = f"{Decimal(0) if closed else max(Decimal(0), expected - paid):.2f}"
    result["difference"] = f"{paid - expected:.2f}" if closed and not row["cancelled"] else "0.00"
    for key in ("paid", "expected_amount"):
        result[key] = f"{result[key]:.2f}"
    return result


def entry(connection, org, identifier):
    row = (
        connection.execute(
            text(SUMMARY + " WHERE e.id=:id AND e.organization_id=:org"),
            {"id": identifier, "org": org},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise HTTPException(404, "Lançamento não encontrado.")
    return present(row)


def validate_fields(connection, org, payload):
    if not payload.description.strip():
        raise HTTPException(422, "Informe a descrição do lançamento.")
    validate_identification(
        connection,
        org,
        Identification(
            **{
                key: getattr(payload, key)
                for key in ("category_id", "subcategory_id", "cost_center_id", "party_id")
            }
        ),
    )
    if payload.account_id and not connection.scalar(
        text(
            "SELECT 1 FROM bank_accounts WHERE id=:id AND organization_id=:org AND active AND currency='BRL'"
        ),
        {"id": payload.account_id, "org": org},
    ):
        raise HTTPException(422, "Selecione uma conta ativa em BRL desta organização.")


def occurrence_date(first, frequency, index):
    if frequency == "WEEKLY":
        return first + timedelta(weeks=index)
    months = index if frequency == "MONTHLY" else index * 12 if frequency == "YEARLY" else 0
    year, month0 = divmod(first.year * 12 + first.month - 1 + months, 12)
    return date(year, month0 + 1, min(first.day, calendar.monthrange(year, month0 + 1)[1]))


@router.post("", status_code=201)
def create(organization_id: UUID, payload: NewEntry, request: Request):
    if payload.frequency == "ONCE" and payload.occurrences != 1:
        raise HTTPException(422, "Lançamento único deve ter uma ocorrência.")
    try:
        dates = [
            occurrence_date(payload.due_on, payload.frequency, i)
            for i in range(payload.occurrences)
        ]
    except (ValueError, OverflowError) as error:
        raise HTTPException(422, "O período da recorrência é inválido.") from error
    digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        prior = (
            connection.execute(
                text(
                    "SELECT id,payload_hash FROM planned_series WHERE organization_id=:org AND request_key=:key"
                ),
                {"org": organization_id, "key": payload.request_key},
            )
            .mappings()
            .one_or_none()
        )
        if prior:
            if prior["payload_hash"] != digest:
                raise HTTPException(409, "Esta solicitação já foi usada com outros dados.")
            return {"created": payload.occurrences, "repeated": True}
        validate_fields(connection, organization_id, payload)
        series = connection.scalar(
            text(
                "INSERT INTO planned_series(organization_id,request_key,payload_hash,actor_id) VALUES(:org,:key,:hash,:actor) RETURNING id"
            ),
            {
                "org": organization_id,
                "key": payload.request_key,
                "hash": digest,
                "actor": actor(connection),
            },
        )
        values = payload.model_dump(exclude={"request_key"})
        for index, due in enumerate(dates):
            connection.execute(
                text("""INSERT INTO planned_entries(organization_id,series_id,occurrence,occurrences,frequency,description,due_on,direction,expected_amount,account_id,category_id,subcategory_id,cost_center_id,party_id,notes)
                VALUES(:org,:series,:occurrence,:occurrences,:frequency,:description,:due_on,:direction,:expected_amount,:account_id,:category_id,:subcategory_id,:cost_center_id,:party_id,:notes)"""),
                {
                    **values,
                    "description": payload.description.strip(),
                    "org": organization_id,
                    "series": series,
                    "occurrence": index + 1,
                    "due_on": due,
                },
            )
        audit(
            connection,
            organization_id,
            "planned_series",
            series,
            "create",
            new=payload.model_dump(),
        )
        return {"created": len(dates), "repeated": False}


@router.get("")
def listing(
    organization_id: UUID,
    request: Request,
    state: Literal["all", "open", "partial", "realized", "cancelled"] = "all",
    direction: Literal["CREDIT", "DEBIT"] | None = None,
    query: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
):
    with request.app.state.database.connect() as connection:
        if not connection.scalar(
            text("SELECT 1 FROM organizations WHERE id=:org"), {"org": organization_id}
        ):
            raise HTTPException(404, "Organização não encontrada.")
        params = {"org": organization_id, "direction": direction}
        sql = (
            SUMMARY
            + " WHERE e.organization_id=:org AND (CAST(:direction AS text) IS NULL OR e.direction=:direction)"
        )
        words = "".join(
            c for c in unicodedata.normalize("NFD", query.lower()) if not unicodedata.combining(c)
        ).split()
        for i, word in enumerate(words):
            sql += f" AND translate(lower(concat_ws(' ',e.description,p.display_name,c.name,cc.name)),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') LIKE :word{i}"
            params[f"word{i}"] = "%" + word + "%"
        rows = [
            present(row)
            for row in connection.execute(text(sql + " ORDER BY e.due_on,e.id"), params).mappings()
        ]
        if state == "open":
            rows = [row for row in rows if row["state"] in ("open", "partial")]
        elif state != "all":
            rows = [row for row in rows if row["state"] == state]
        totals = {
            "expected": f"{sum((Decimal(row['expected_amount']) for row in rows), Decimal(0)):.2f}",
            "paid": f"{sum((Decimal(row['paid']) for row in rows), Decimal(0)):.2f}",
            "receivable": f"{sum((Decimal(row['outstanding']) for row in rows if row['direction'] == 'CREDIT'), Decimal(0)):.2f}",
            "payable": f"{sum((Decimal(row['outstanding']) for row in rows if row['direction'] == 'DEBIT'), Decimal(0)):.2f}",
        }
        start = (page - 1) * page_size
        return {"rows": rows[start : start + page_size], "total": len(rows), "totals": totals}


@router.put("/{entry_id}")
def edit(organization_id: UUID, entry_id: UUID, payload: EditEntry, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        old = entry(connection, organization_id, entry_id)
        if old["version"] != payload.expected_version:
            raise HTTPException(409, "O lançamento mudou. Atualize antes de salvar.")
        if old["state"] != "open":
            raise HTTPException(
                409,
                "Somente lançamentos sem baixas e em aberto podem ser editados. Desvincule as baixas antes de alterar.",
            )
        validate_fields(connection, organization_id, payload)
        connection.execute(
            text(
                """UPDATE planned_entries SET description=:description,due_on=:due_on,direction=:direction,expected_amount=:expected_amount,account_id=:account_id,category_id=:category_id,subcategory_id=:subcategory_id,cost_center_id=:cost_center_id,party_id=:party_id,notes=:notes,version=version+1 WHERE id=:id"""
            ),
            {**payload.model_dump(exclude={"expected_version"}), "id": entry_id},
        )
        audit(
            connection,
            organization_id,
            "planned_entries",
            entry_id,
            "edit",
            old,
            payload.model_dump(),
        )
        return entry(connection, organization_id, entry_id)


@router.post("/{entry_id}/cancel")
def cancel(organization_id: UUID, entry_id: UUID, payload: Version, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        old = entry(connection, organization_id, entry_id)
        if old["version"] != payload.expected_version:
            raise HTTPException(409, "O lançamento mudou. Atualize antes de cancelar.")
        if old["state"] not in ("open", "partial"):
            raise HTTPException(409, "Este lançamento não possui saldo em aberto.")
        connection.execute(
            text("UPDATE planned_entries SET cancelled=true,version=version+1 WHERE id=:id"),
            {"id": entry_id},
        )
        audit(connection, organization_id, "planned_entries", entry_id, "cancel", old)
        return entry(connection, organization_id, entry_id)


@router.get("/links/{transaction_id}")
def link_info(organization_id: UUID, transaction_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        transaction(connection, organization_id, transaction_id)
        link = (
            connection.execute(text(ACTIVE_LINK), {"tx": transaction_id, "org": organization_id})
            .mappings()
            .one_or_none()
        )
        return (
            {"link_id": link["id"], "entry": entry(connection, organization_id, link["entry_id"])}
            if link
            else None
        )


@router.get("/{entry_id}/settlements")
def settlements(organization_id: UUID, entry_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        entry(connection, organization_id, entry_id)
        rows = connection.execute(
            text("""SELECT l.id,l.transaction_id,l.amount,l.finish,l.created_at,
            t.posted_on,t.raw_description,a.label AS account_label,
            EXISTS(SELECT 1 FROM settlement_reversals r WHERE r.settlement_id=l.id) AS reversed
            FROM entry_settlements l JOIN bank_transactions t ON t.id=l.transaction_id
            JOIN bank_accounts a ON a.id=t.account_id WHERE l.entry_id=:id ORDER BY l.created_at DESC"""),
            {"id": entry_id},
        ).mappings()
        return [{**dict(row), "amount": f"{row['amount']:.2f}"} for row in rows]


@router.post("/{entry_id}/settle")
def settle(organization_id: UUID, entry_id: UUID, payload: Settlement, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        record = transaction(connection, organization_id, payload.transaction_id)
        old = entry(connection, organization_id, entry_id)
        prior = (
            connection.execute(
                text(ACTIVE_LINK), {"org": organization_id, "tx": payload.transaction_id}
            )
            .mappings()
            .one_or_none()
        )
        if prior:
            if prior["entry_id"] == entry_id:
                return {"linked": True, "repeated": True}
            raise HTTPException(409, "Este movimento já está vinculado a outro lançamento.")
        if (
            old["version"] != payload.expected_entry_version
            or (record.get("version") or 0) != payload.expected_transaction_version
        ):
            raise HTTPException(409, "Os dados mudaram. Atualize antes de vincular.")
        if old["state"] not in ("open", "partial"):
            raise HTTPException(409, "Selecione um lançamento em aberto.")
        if old["direction"] != record["direction"] or old["currency"] != record["currency"]:
            raise HTTPException(
                422, "A direção e a moeda do movimento devem corresponder ao lançamento."
            )
        if old["account_id"] and old["account_id"] != record["account_id"]:
            raise HTTPException(
                422,
                "O lançamento está previsto para outra conta bancária. Revise antes de vincular.",
            )
        remaining = Decimal(old["outstanding"])
        if (
            record["amount"] > remaining or (payload.finish and record["amount"] != remaining)
        ) and not payload.confirm_difference:
            raise HTTPException(422, "Confirme a diferença de valor antes de concluir a baixa.")
        identification = Identification(
            **{
                key: old[key]
                for key in ("party_id", "category_id", "subcategory_id", "cost_center_id")
            },
            notes=payload.notes,
            expected_version=payload.expected_transaction_version,
        )
        save_identification(connection, organization_id, record, identification)
        identifier = connection.scalar(
            text(
                "INSERT INTO entry_settlements(entry_id,transaction_id,amount,finish,actor_id) VALUES(:entry,:tx,:amount,:finish,:actor) RETURNING id"
            ),
            {
                "entry": entry_id,
                "tx": payload.transaction_id,
                "amount": record["amount"],
                "finish": payload.finish,
                "actor": actor(connection),
            },
        )
        connection.execute(
            text("UPDATE planned_entries SET version=version+1 WHERE id=:id"), {"id": entry_id}
        )
        audit(
            connection,
            organization_id,
            "entry_settlements",
            identifier,
            "settle",
            new={
                "entry_id": entry_id,
                "transaction_id": payload.transaction_id,
                "amount": record["amount"],
                "finish": payload.finish,
            },
        )
        return {"linked": True, "entry": entry(connection, organization_id, entry_id)}


@router.post("/links/{transaction_id}/reverse")
def reverse(organization_id: UUID, transaction_id: UUID, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        transaction(connection, organization_id, transaction_id)
        link = (
            connection.execute(text(ACTIVE_LINK), {"org": organization_id, "tx": transaction_id})
            .mappings()
            .one_or_none()
        )
        if link is None:
            raise HTTPException(404, "Vínculo ativo não encontrado.")
        identifier = connection.scalar(
            text(
                "INSERT INTO settlement_reversals(settlement_id,actor_id) VALUES(:link,:actor) RETURNING id"
            ),
            {"link": link["id"], "actor": actor(connection)},
        )
        connection.execute(
            text("UPDATE planned_entries SET version=version+1 WHERE id=:id"),
            {"id": link["entry_id"]},
        )
        audit(
            connection,
            organization_id,
            "settlement_reversals",
            identifier,
            "reverse",
            new={"settlement_id": link["id"], "entry_id": link["entry_id"]},
        )
        return {"reversed": True}
