"""Planejamento, recorrência e baixas rastreáveis por movimentos do extrato."""

import calendar
import hashlib
import json
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

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
        COALESCE(s.discount, 0) AS discount, COALESCE(s.surcharge, 0) AS surcharge,
        NOT EXISTS(SELECT 1 FROM entry_settlements h WHERE h.entry_id=e.id) AS can_delete,
        p.display_name AS party_name, a.label AS account_label,
        c.name AS category_name, sub.name AS subcategory_name, cc.name AS cost_center_name
    FROM planned_entries e
    LEFT JOIN LATERAL (
        SELECT sum(l.amount) AS paid, bool_or(l.finish) AS finished,
            sum(l.discount) AS discount, sum(l.surcharge) AS surcharge
        FROM entry_settlements l WHERE l.entry_id=e.id
        AND NOT EXISTS(SELECT 1 FROM settlement_reversals r WHERE r.settlement_id=l.id)
    ) s ON true
    LEFT JOIN parties p ON p.id=e.party_id
    LEFT JOIN bank_accounts a ON a.id=e.account_id
    JOIN categories c ON c.id=e.category_id
    JOIN subcategories sub ON sub.id=e.subcategory_id
    LEFT JOIN cost_centers cc ON cc.id=e.cost_center_id
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
    cost_center_id: UUID | None = None
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


class Exclusion(Version):
    scope: Literal["current", "following"] = "current"
    expected_revision: str = Field(min_length=64, max_length=64)


class Settlement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transaction_id: UUID
    expected_transaction_version: int = Field(default=0, ge=0)
    expected_entry_version: int = Field(ge=1)
    finish: bool = False
    confirm_difference: bool = False
    notes: str | None = Field(default=None, max_length=4000)
    difference_treatment: Literal["KEEP_OPEN", "DISCOUNT", "SURCHARGE"] | None = None
    category_id: UUID | None = None
    subcategory_id: UUID | None = None
    cost_center_id: UUID | None = None
    party_id: UUID | None = None


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
    principal = paid + row["discount"] - row["surcharge"]
    closed = row["cancelled"] or row["finished"] or principal >= expected
    result["state"] = (
        "cancelled" if row["cancelled"] else "realized" if closed else "partial" if paid else "open"
    )
    result["situation"] = (
        "cancelled"
        if row["cancelled"]
        else "paid"
        if closed
        else "overdue"
        if row["due_on"] < datetime.now(ZoneInfo("America/Sao_Paulo")).date()
        else "upcoming"
    )
    result["outstanding"] = f"{Decimal(0) if closed else max(Decimal(0), expected - principal):.2f}"
    result["difference"] = f"{paid - expected:.2f}" if closed and not row["cancelled"] else "0.00"
    for key in ("paid", "expected_amount", "discount", "surcharge"):
        result[key] = f"{result[key]:.2f}"
    return result


def entry(connection, org, identifier):
    row = (
        connection.execute(
            text(SUMMARY + " WHERE e.id=:id AND e.organization_id=:org AND e.deleted_at IS NULL"),
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
                for key in (
                    "category_id",
                    "subcategory_id",
                    "cost_center_id",
                    "party_id",
                )
            }
        ),
        require_complete=False,
        direction=payload.direction,
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
    state: Literal[
        "all", "active", "open", "partial", "realized", "cancelled", "upcoming", "overdue", "paid"
    ] = "all",
    direction: Literal["CREDIT", "DEBIT"] | None = None,
    query: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    sort_by: Literal[
        "due_on", "description", "expected_amount", "paid", "outstanding", "state"
    ] = "due_on",
    sort_order: Literal["asc", "desc"] = "asc",
):
    with request.app.state.database.connect() as connection:
        if not connection.scalar(
            text("SELECT 1 FROM organizations WHERE id=:org"), {"org": organization_id}
        ):
            raise HTTPException(404, "Organização não encontrada.")
        params = {"org": organization_id, "direction": direction}
        sql = (
            SUMMARY
            + " WHERE e.organization_id=:org AND e.deleted_at IS NULL AND (CAST(:direction AS text) IS NULL OR e.direction=:direction)"
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
        if state == "active":
            rows = [row for row in rows if row["state"] != "cancelled"]
        elif state == "open":
            rows = [row for row in rows if row["state"] in ("open", "partial")]
        elif state in ("upcoming", "overdue", "paid"):
            rows = [row for row in rows if row["situation"] == state]
        elif state != "all":
            rows = [row for row in rows if row["state"] == state]
        situation_labels = {
            "upcoming": "A vencer",
            "overdue": "Vencido",
            "paid": "Baixado",
            "cancelled": "Cancelado",
        }

        def order_value(row):
            if sort_by in {"expected_amount", "paid", "outstanding"}:
                return Decimal(row[sort_by])
            value = situation_labels[row["situation"]] if sort_by == "state" else row[sort_by]
            return "".join(
                c
                for c in unicodedata.normalize("NFD", str(value).casefold())
                if not unicodedata.combining(c)
            )

        rows.sort(key=order_value, reverse=sort_order == "desc")
        totals = {
            "expected": f"{sum((Decimal(row['expected_amount']) for row in rows), Decimal(0)):.2f}",
            "paid": f"{sum((Decimal(row['paid']) for row in rows), Decimal(0)):.2f}",
            "receivable": f"{sum((Decimal(row['outstanding']) for row in rows if row['direction'] == 'CREDIT'), Decimal(0)):.2f}",
            "payable": f"{sum((Decimal(row['outstanding']) for row in rows if row['direction'] == 'DEBIT'), Decimal(0)):.2f}",
        }
        start = (page - 1) * page_size
        return {
            "rows": rows[start : start + page_size],
            "total": len(rows),
            "totals": totals,
        }


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


def exclusion_selection(connection, org, old, scope):
    condition = (
        "e.id=:id" if scope == "current" else "e.series_id=:series AND e.occurrence>=:occurrence"
    )
    rows = [
        present(row)
        for row in connection.execute(
            text(
                SUMMARY
                + " WHERE e.organization_id=:org AND e.deleted_at IS NULL AND "
                + condition
                + " ORDER BY e.occurrence"
            ),
            {
                "org": org,
                "id": old["id"],
                "series": old["series_id"],
                "occurrence": old["occurrence"],
            },
        ).mappings()
    ]
    # Revisão otimista de toda a seleção: não excluir parcelas alteradas após a prévia.
    revision = hashlib.sha256(
        json.dumps([[str(row["id"]), row["version"], row["can_delete"]] for row in rows]).encode()
    ).hexdigest()
    return rows, revision


@router.get("/{entry_id}/exclusion-preview")
def exclusion_preview(
    organization_id: UUID,
    entry_id: UUID,
    request: Request,
    scope: Literal["current", "following"] = "current",
):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        old = entry(connection, organization_id, entry_id)
        rows, revision = exclusion_selection(connection, organization_id, old, scope)
        return {
            "count": len(rows),
            "blocked": sum(not row["can_delete"] for row in rows),
            "revision": revision,
            "version": old["version"],
            "description": old["description"],
            "total_expected": f"{sum((Decimal(row['expected_amount']) for row in rows), Decimal(0)):.2f}",
            "first_due_on": rows[0]["due_on"],
            "last_due_on": rows[-1]["due_on"],
        }


@router.post("/{entry_id}/exclude")
def exclude(organization_id: UUID, entry_id: UUID, payload: Exclusion, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        old = entry(connection, organization_id, entry_id)
        rows, revision = exclusion_selection(connection, organization_id, old, payload.scope)
        if old["version"] != payload.expected_version or revision != payload.expected_revision:
            raise HTTPException(409, "A seleção mudou. Atualize a prévia antes de excluir.")
        if any(not row["can_delete"] for row in rows):
            raise HTTPException(
                409,
                "A seleção possui histórico de baixas e não pode ser excluída. Nenhum lançamento foi excluído.",
            )
        for row in rows:
            connection.execute(
                text("UPDATE planned_entries SET deleted_at=now(),version=version+1 WHERE id=:id"),
                {"id": row["id"]},
            )
            audit(
                connection,
                organization_id,
                "planned_entries",
                row["id"],
                "exclude",
                row,
                {"scope": payload.scope, "source_entry_id": str(entry_id)},
            )
        return {"excluded": len(rows)}


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
            {
                "link_id": link["id"],
                "entry": entry(connection, organization_id, link["entry_id"]),
            }
            if link
            else None
        )


@router.get("/suggestions/{transaction_id}")
def suggestions(
    organization_id: UUID,
    transaction_id: UUID,
    request: Request,
    party_id: UUID | None = None,
    derive_party: bool = True,
):
    """Cliente explícito + saldo/vencimento; nunca vincula automaticamente."""
    with request.app.state.database.connect() as connection:
        record = transaction(connection, organization_id, transaction_id)
        party = party_id or (record.get("party_id") if derive_party else None)
        if not party and derive_party:
            suggestion = connection.scalar(
                text("""SELECT payload FROM transaction_suggestions
                    WHERE transaction_id=:tx AND organization_id=:org
                    ORDER BY created_at DESC LIMIT 1"""),
                {"tx": transaction_id, "org": organization_id},
            )
            party = suggestion.get("party_id") if suggestion else None
        if not party:
            return {"rows": [], "reason": "Identifique o cliente para sugerir seus títulos."}
        rows = [
            present(row)
            for row in connection.execute(
                text(
                    SUMMARY
                    + """ WHERE e.organization_id=:org AND e.party_id=:party
                    AND e.direction=:direction AND e.currency=:currency
                    AND e.deleted_at IS NULL AND NOT e.cancelled
                    AND (e.account_id IS NULL OR e.account_id=:account)"""
                ),
                {
                    "org": organization_id,
                    "party": party,
                    "direction": record["direction"],
                    "currency": record["currency"],
                    "account": record["account_id"],
                },
            ).mappings()
        ]
        rows = [r for r in rows if r["state"] in ("open", "partial")]
        exact = sum(Decimal(r["outstanding"]) == record["amount"] for r in rows)
        for row in rows:
            matches = Decimal(row["outstanding"]) == record["amount"]
            row["confidence"] = "HIGH" if matches and exact == 1 else "MEDIUM"
            row["reason"] = (
                "Mesmo cliente e saldo igual ao valor do extrato. Confira o vencimento."
                if matches
                else "Mesmo cliente, com diferença de valor. Revise a baixa e o saldo."
            )
        rows.sort(
            key=lambda r: (
                Decimal(r["outstanding"]) != record["amount"],
                abs((r["due_on"] - record["posted_on"]).days),
                r["due_on"],
                str(r["id"]),
            )
        )
        return {"rows": rows, "reason": "Sugestões aguardam confirmação do operador."}


@router.get("/{entry_id}/settlements")
def settlements(organization_id: UUID, entry_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        entry(connection, organization_id, entry_id)
        rows = connection.execute(
            text("""SELECT l.id,l.transaction_id,l.amount,l.finish,l.created_at,
            l.discount,l.surcharge,l.review_json,
            t.posted_on,t.raw_description,a.label AS account_label,
            EXISTS(SELECT 1 FROM settlement_reversals r WHERE r.settlement_id=l.id) AS reversed
            FROM entry_settlements l JOIN bank_transactions t ON t.id=l.transaction_id
            JOIN bank_accounts a ON a.id=t.account_id WHERE l.entry_id=:id ORDER BY l.created_at DESC"""),
            {"id": entry_id},
        ).mappings()
        return [
            {**dict(row), **{key: f"{row[key]:.2f}" for key in ("amount", "discount", "surcharge")}}
            for row in rows
        ]


@router.post("/{entry_id}/settle")
def settle(organization_id: UUID, entry_id: UUID, payload: Settlement, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        record = transaction(connection, organization_id, payload.transaction_id)
        old = entry(connection, organization_id, entry_id)
        prior = (
            connection.execute(
                text(ACTIVE_LINK),
                {"org": organization_id, "tx": payload.transaction_id},
            )
            .mappings()
            .one_or_none()
        )
        digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
        if prior:
            if prior["entry_id"] == entry_id:
                if prior["payload_hash"] and prior["payload_hash"] != digest:
                    raise HTTPException(
                        409, "A baixa já foi gravada com outros dados. Atualize a tela."
                    )
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
                422,
                "A direção e a moeda do movimento devem corresponder ao lançamento.",
            )
        if old["account_id"] and old["account_id"] != record["account_id"]:
            raise HTTPException(
                422,
                "O lançamento está previsto para outra conta bancária. Revise antes de vincular.",
            )
        remaining = Decimal(old["outstanding"])
        received = record["amount"]
        treatment = payload.difference_treatment
        if treatment is None:
            treatment = (
                "SURCHARGE"
                if received > remaining
                else "DISCOUNT"
                if payload.finish
                else "KEEP_OPEN"
            )
        if treatment == "DISCOUNT" and received >= remaining:
            raise HTTPException(422, "Desconto exige valor recebido menor que o saldo em aberto.")
        if treatment == "SURCHARGE" and received <= remaining:
            raise HTTPException(422, "Acréscimo exige valor recebido maior que o saldo em aberto.")
        if received > remaining and treatment != "SURCHARGE":
            raise HTTPException(422, "Confirme o acréscimo comercial para quitar com valor maior.")
        discount = remaining - received if treatment == "DISCOUNT" else Decimal(0)
        surcharge = received - remaining if treatment == "SURCHARGE" else Decimal(0)
        if (discount or surcharge) and not payload.confirm_difference:
            raise HTTPException(422, "Confirme a diferença de valor antes de concluir a baixa.")
        fields = {
            key: getattr(payload, key) if key in payload.model_fields_set else old[key]
            for key in ("party_id", "category_id", "subcategory_id", "cost_center_id")
        }
        if not fields["cost_center_id"]:
            raise HTTPException(
                422, "Informe o centro de custos da baixa. O título original será preservado."
            )
        identification = Identification(
            **fields,
            notes=payload.notes,
            customer_group_id=record.get("customer_group_id") if not fields["party_id"] else None,
            expected_version=payload.expected_transaction_version,
        )
        save_identification(connection, organization_id, record, identification)
        review = {
            "identification": identification.model_dump(mode="json"),
            "original_title": {
                key: old[key] for key in (*fields.keys(), "expected_amount", "due_on")
            },
            "outstanding_before": str(remaining),
            "treatment": treatment,
            "discount": str(discount),
            "surcharge": str(surcharge),
        }
        identifier = connection.scalar(
            text(
                """INSERT INTO entry_settlements(entry_id,transaction_id,amount,finish,actor_id,
                    discount,surcharge,review_json,payload_hash)
                    VALUES(:entry,:tx,:amount,:finish,:actor,:discount,:surcharge,CAST(:review AS jsonb),:hash) RETURNING id"""
            ),
            {
                "entry": entry_id,
                "tx": payload.transaction_id,
                "amount": record["amount"],
                "finish": treatment != "KEEP_OPEN",
                "discount": discount,
                "surcharge": surcharge,
                "review": json.dumps(review, default=str),
                "hash": digest,
                "actor": actor(connection),
            },
        )
        connection.execute(
            text("UPDATE planned_entries SET version=version+1 WHERE id=:id"),
            {"id": entry_id},
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
                "review": review,
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
