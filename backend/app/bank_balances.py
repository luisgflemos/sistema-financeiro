"""Extrato de conta corrente, referências bancárias e ajustes auditados."""

import hashlib
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.planning import audit
from app.statements import actor

router = APIRouter(
    prefix="/organizations/{organization_id}/bank-balances", tags=["Extrato Bancário"]
)
ZERO = Decimal("0.00")


def money(value):
    if value in (None, ""):
        return None
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount != amount.quantize(Decimal(".01")):
            return None
        return amount
    except (InvalidOperation, ValueError):
        return None


def signed(row):
    return row["amount"] if row["direction"] == "CREDIT" else -row["amount"]


def order_day(rows, balance):
    """Preservar a ordem de cada arquivo; encadear arquivos só quando inequívoco."""
    groups = defaultdict(list)
    for row in rows:
        groups[str(row["import_file_id"])].append(row)
    for group in groups.values():
        historical = all(r.get("source_kind") == "identified_history" for r in group)
        group.sort(key=lambda r: r["source_row"] if historical else -r["source_row"])
    pending = sorted(
        groups.values(), key=lambda g: (str(g[0]["file_created_at"]), str(g[0]["import_file_id"]))
    )
    ordered, ambiguous = [], False
    current = balance
    while pending:
        matching = [
            g
            for g in pending
            if current is not None
            and g[0]["bank_balance"] is not None
            and g[0]["bank_balance"] - signed(g[0]) == current
        ]
        if len(pending) == 1:
            group = pending[0]
        elif len(matching) == 1:
            group = matching[0]
        else:
            group = pending[0]
            ambiguous = True
        row = group.pop(0)
        ordered.append(row)
        if current is not None:
            current += signed(row)
        if not group:
            pending.remove(group)
    return ordered, ambiguous


def build_ledger(account, movements, events):
    days = defaultdict(list)
    for source in movements:
        row = dict(source)
        row["bank_balance"] = money(row.get("bank_balance"))
        days[row["posted_on"]].append(row)
    automatic = None
    for day in sorted(days):
        rows = days[day]
        if (
            any(r["bank_balance"] is not None for r in rows)
            and len({r["import_file_id"] for r in rows}) == 1
            and not any(r.get("source_kind") == "identified_history" for r in rows)
        ):
            prefix = ZERO
            for first in sorted(rows, key=lambda r: -r["source_row"]):
                prefix += signed(first)
                if first["bank_balance"] is not None:
                    break
            automatic = {
                "date": day,
                "amount": first["bank_balance"] - prefix,
                "source": "statement",
                "file_name": first["file_name"],
                "source_row": first["source_row"],
            }
            break
        if rows and all(r["bank_balance"] is not None for r in rows):
            heads = {}
            for row in rows:
                file = row["import_file_id"]
                if file not in heads or row["source_row"] > heads[file]["source_row"]:
                    heads[file] = row
            valid = []
            for opening in {r["bank_balance"] - signed(r) for r in heads.values()}:
                ordered, ambiguous = order_day(rows, opening)
                running = opening
                matches = True
                for row in ordered:
                    running += signed(row)
                    matches = matches and running == row["bank_balance"]
                if matches and not ambiguous:
                    valid.append((opening, ordered[0]))
            if len(valid) == 1:
                opening, first = valid[0]
                automatic = {
                    "date": day,
                    "amount": opening,
                    "source": "statement",
                    "file_name": first["file_name"],
                    "source_row": first["source_row"],
                }
                break
    active = [e for e in events if not e["reversed"]]
    manual = next((e for e in active if e["kind"] == "OPENING"), None)
    anchor = automatic or (
        {
            "date": manual["posted_on"],
            "amount": manual["amount"],
            "source": "manual",
            "file_name": None,
            "source_row": None,
        }
        if manual
        else None
    )
    adjustments = defaultdict(list)
    for event in active:
        if event["kind"] == "ADJUSTMENT":
            adjustments[event["posted_on"]].append(event)
    current = anchor["amount"] if anchor else None
    result, mismatches, ambiguous_days = [], [], []
    last_bank = None
    last_bank_index = -1
    before_anchor = 0
    for day in sorted(set(days) | set(adjustments)):
        available = bool(anchor and day >= anchor["date"])
        rows, ambiguous = order_day(days[day], current if available else None)
        if ambiguous and available:
            ambiguous_days.append(day)
        for row in rows:
            if available:
                current += signed(row)
            else:
                before_anchor += 1
            difference = (
                current - row["bank_balance"]
                if available and row["bank_balance"] is not None
                else None
            )
            item = {
                **row,
                "kind": "MOVEMENT",
                "signed_amount": signed(row),
                "calculated_balance": current if available else None,
                "difference": difference,
                "reason": None,
            }
            result.append(item)
            if row["bank_balance"] is not None:
                last_bank = {
                    "date": day,
                    "amount": row["bank_balance"],
                    "file_name": row["file_name"],
                    "source_row": row["source_row"],
                    "transaction_id": row["id"],
                }
                last_bank_index = len(result) - 1
            if difference:
                mismatches.append(
                    {
                        "date": day,
                        "transaction_id": row["id"],
                        "difference": difference,
                        "file_name": row["file_name"],
                        "source_row": row["source_row"],
                    }
                )
        for event in sorted(adjustments[day], key=lambda e: (str(e["created_at"]), str(e["id"]))):
            if available:
                current += event["amount"]
            result.append(
                {
                    "id": event["id"],
                    "posted_on": day,
                    "kind": "ADJUSTMENT",
                    "raw_description": "Ajuste de saldo",
                    "signed_amount": event["amount"],
                    "calculated_balance": current if available else None,
                    "bank_balance": None,
                    "difference": None,
                    "reason": event["reason"],
                    "file_name": None,
                    "source_row": None,
                }
            )
    after_reference = any(r["kind"] == "ADJUSTMENT" for r in result[last_bank_index + 1 :])
    unverified = last_bank is not None and any(
        r["kind"] == "MOVEMENT" for r in result[last_bank_index + 1 :]
    )
    state = (
        "missing_opening"
        if not anchor
        else "difference"
        if mismatches or ambiguous_days
        else "adjusted"
        if after_reference
        else "unverified"
        if unverified
        else "consistent"
        if last_bank
        else "manual"
    )
    summary = {
        "account_id": account["id"],
        "label": account["label"],
        "currency": account["currency"],
        "active": account["active"],
        "state": state,
        "calculated_balance": current if anchor else None,
        "as_of": max(
            [r["posted_on"] for r in result] + ([anchor["date"]] if anchor else []), default=None
        ),
        "opening": anchor,
        "last_bank_balance": last_bank,
        "differences": mismatches,
        "ambiguous_dates": ambiguous_days,
        "unreferenced_movements": before_anchor,
        "manual_opening_superseded": bool(automatic and manual),
        "movements": len(movements),
        "adjustments": sum(1 for r in result if r["kind"] == "ADJUSTMENT"),
        "needs_opening": anchor is None,
    }
    summary["first_movement_date"] = min(days, default=None)
    summary["difference_count"] = len(mismatches)
    summary["differences"] = mismatches[:50]
    return summary, result


def account_data(connection, org, identifier=None):
    rows = (
        connection.execute(
            text(
                "SELECT id,label,currency,active FROM bank_accounts WHERE organization_id=:org AND (CAST(:id AS uuid) IS NULL OR id=:id) ORDER BY label,id"
            ),
            {"org": org, "id": identifier},
        )
        .mappings()
        .all()
    )
    if identifier and not rows:
        raise HTTPException(404, "Conta não encontrada nesta organização.")
    return [dict(r) for r in rows]


def data(connection, org, identifier=None):
    movements = (
        connection.execute(
            text("""SELECT t.id,t.account_id,t.import_file_id,t.source_row,t.posted_on,
        t.direction,t.amount,t.raw_description,t.raw_payload->>'saldo' AS bank_balance,
        t.raw_payload->>'source_kind' AS source_kind,
        f.file_name,b.created_at AS file_created_at
        FROM active_bank_transactions t JOIN bank_accounts a ON a.id=t.account_id
        JOIN import_files f ON f.id=t.import_file_id
        JOIN import_batches b ON b.id=f.batch_id
        WHERE a.organization_id=:org AND (CAST(:id AS uuid) IS NULL OR a.id=:id)"""),
            {"org": org, "id": identifier},
        )
        .mappings()
        .all()
    )
    events = (
        connection.execute(
            text("""SELECT e.*,EXISTS(SELECT 1 FROM bank_balance_reversals r WHERE r.event_id=e.id) AS reversed
        FROM bank_balance_events e WHERE e.organization_id=:org
        AND (CAST(:id AS uuid) IS NULL OR e.account_id=:id) ORDER BY e.created_at,e.id"""),
            {"org": org, "id": identifier},
        )
        .mappings()
        .all()
    )
    return movements, events


def serialize(value):
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [serialize(v) for v in value]
    return value


def total_positions(accounts):
    """Somar posições conhecidas por moeda, sem presumir saldo zero nem data comum."""
    totals = []
    for currency in sorted({a["currency"] for a in accounts}):
        group = [a for a in accounts if a["currency"] == currency]
        known = [a for a in group if a["calculated_balance"] is not None]
        dates = sorted({a["as_of"] for a in known if a["as_of"]})
        totals.append(
            {
                "currency": currency,
                "amount": sum((money(a["calculated_balance"]) for a in known), ZERO)
                if known
                else None,
                "known_accounts": len(known),
                "missing_accounts": len(group) - len(known),
                "first_date": dates[0] if dates else None,
                "last_date": dates[-1] if dates else None,
                "needs_review": any(a["state"] != "consistent" for a in known),
            }
        )
    return totals


@router.get("")
def overview(organization_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        if not connection.in_transaction():
            connection.execution_options(isolation_level="REPEATABLE READ")
        if not connection.scalar(
            text("SELECT 1 FROM organizations WHERE id=:org"), {"org": organization_id}
        ):
            raise HTTPException(404, "Organização não encontrada.")
        accounts = account_data(connection, organization_id)
        movements, events = data(connection, organization_id)
        positions = [
            build_ledger(
                a,
                [r for r in movements if r["account_id"] == a["id"]],
                [dict(e) for e in events if e["account_id"] == a["id"]],
            )[0]
            for a in accounts
        ]
        return serialize({"accounts": positions, "totals": total_positions(positions)})


@router.get("/all")
def consolidated_ledger(
    organization_id: UUID,
    request: Request,
    currency: str = Query(default="BRL", min_length=3, max_length=3),
    start: date | None = None,
    end: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    query: str = Query(default="", max_length=200),
    sort_by: Literal[
        "date", "account", "description", "amount", "balance", "reported", "difference"
    ] = "date",
    sort_order: Literal["asc", "desc"] = "asc",
):
    if start and end and start > end:
        raise HTTPException(422, "O fim do período deve ser igual ou posterior ao início.")
    with request.app.state.database.connect() as connection:
        if not connection.in_transaction():
            connection.execution_options(isolation_level="REPEATABLE READ")
        if not connection.scalar(
            text("SELECT 1 FROM organizations WHERE id=:org"), {"org": organization_id}
        ):
            raise HTTPException(404, "Organização não encontrada.")
        accounts = account_data(connection, organization_id)
        movements, events = data(connection, organization_id)
        rows = []
        for account in accounts:
            if account["currency"] != currency:
                continue
            _, ledger_rows = build_ledger(
                account,
                [r for r in movements if r["account_id"] == account["id"]],
                [dict(e) for e in events if e["account_id"] == account["id"]],
            )
            for row in ledger_rows:
                rows.append(
                    {
                        **row,
                        "account_label": account["label"],
                        "account_id": account["id"],
                        "currency": currency,
                    }
                )
        # Ordenação estável entre contas, preservando a sequência bancária de cada dia.
        rows.sort(
            key=lambda r: (r["posted_on"], r["account_label"].casefold(), str(r["account_id"]))
        )
        words = query.casefold().split()
        filtered = [
            r
            for r in rows
            if (not start or r["posted_on"] >= start)
            and (not end or r["posted_on"] <= end)
            and all(
                w
                in " ".join(
                    str(r.get(k) or "")
                    for k in ("raw_description", "account_label", "reason", "file_name")
                ).casefold()
                for w in words
            )
        ]
        if sort_by != "date":
            field = {
                "account": "account_label",
                "description": "raw_description",
                "amount": "signed_amount",
                "balance": "calculated_balance",
                "reported": "bank_balance",
                "difference": "difference",
            }[sort_by]
            filtered.sort(
                key=lambda r: (
                    r[field] is None,
                    str(r[field]).casefold()
                    if sort_by in ("description", "account")
                    else r[field] or ZERO,
                ),
                reverse=sort_order == "desc",
            )
        elif sort_order == "desc":
            filtered.reverse()
        offset = (page - 1) * page_size
        return serialize(
            {
                "currency": currency,
                "total": len(filtered),
                "rows": filtered[offset : offset + page_size],
                "page": page,
            }
        )


@router.get("/{account_id}")
def ledger(
    organization_id: UUID,
    account_id: UUID,
    request: Request,
    start: date | None = None,
    end: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    query: str = Query(default="", max_length=200),
    sort_by: Literal["date", "description", "amount", "balance", "reported", "difference"] = "date",
    sort_order: Literal["asc", "desc"] = "asc",
):
    if start and end and start > end:
        raise HTTPException(422, "O fim do período deve ser igual ou posterior ao início.")
    with request.app.state.database.connect() as connection:
        if not connection.in_transaction():
            connection.execution_options(isolation_level="REPEATABLE READ")
        account = account_data(connection, organization_id, account_id)[0]
        movements, events = data(connection, organization_id, account_id)
        summary, rows = build_ledger(account, movements, [dict(e) for e in events])
        first = start or (summary["opening"]["date"] if summary["opening"] else None)
        visible = [
            r
            for r in rows
            if (not first or r["posted_on"] >= first) and (not end or r["posted_on"] <= end)
        ]
        previous = [
            r
            for r in rows
            if first and r["posted_on"] < first and r["calculated_balance"] is not None
        ]
        opening = (
            previous[-1]["calculated_balance"]
            if previous
            else summary["opening"]["amount"]
            if summary["opening"] and (not first or first >= summary["opening"]["date"])
            else None
        )
        # Se o fim do período for anterior à referência, não atribuir abertura conhecida.
        if end and summary["opening"] and end < summary["opening"]["date"]:
            opening = None
        closing = visible[-1]["calculated_balance"] if visible else opening
        totals = {
            "opening": opening,
            "credits": sum(
                (
                    r["signed_amount"]
                    for r in visible
                    if r["kind"] == "MOVEMENT" and r["signed_amount"] > 0
                ),
                ZERO,
            ),
            "debits": -sum(
                (
                    r["signed_amount"]
                    for r in visible
                    if r["kind"] == "MOVEMENT" and r["signed_amount"] < 0
                ),
                ZERO,
            ),
            "adjustments": sum(
                (r["signed_amount"] for r in visible if r["kind"] == "ADJUSTMENT"), ZERO
            ),
            "closing": closing,
        }
        words = query.casefold().split()
        filtered = [
            r
            for r in visible
            if all(
                w
                in (
                    r["raw_description"]
                    + " "
                    + str(r.get("reason") or "")
                    + " "
                    + str(r.get("file_name") or "")
                ).casefold()
                for w in words
            )
        ]
        if sort_by != "date":
            field = {
                "description": "raw_description",
                "amount": "signed_amount",
                "balance": "calculated_balance",
                "reported": "bank_balance",
                "difference": "difference",
            }[sort_by]
            filtered.sort(
                key=lambda r: (
                    r[field] is None,
                    str(r[field]).casefold() if sort_by == "description" else r[field] or ZERO,
                ),
                reverse=sort_order == "desc",
            )
        elif sort_order == "desc":
            filtered.reverse()
        offset = (page - 1) * page_size
        return serialize(
            {
                "summary": summary,
                "start": first,
                "end": end,
                "totals": totals,
                "total": len(filtered),
                "rows": filtered[offset : offset + page_size],
                "events": [dict(e) for e in events],
                "page": page,
            }
        )


class BalanceEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_key: UUID
    kind: Literal["OPENING", "ADJUSTMENT"]
    posted_on: date
    amount: Decimal = Field(max_digits=18, decimal_places=2)
    reason: str = Field(min_length=3, max_length=1000)


class Reversal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/{account_id}/events", status_code=201)
def create_event(organization_id: UUID, account_id: UUID, payload: BalanceEvent, request: Request):
    if len(payload.reason.strip()) < 3 or (payload.kind == "ADJUSTMENT" and payload.amount == 0):
        raise HTTPException(422, "Informe o motivo e um ajuste diferente de zero.")
    if payload.posted_on > datetime.now(ZoneInfo("America/Sao_Paulo")).date():
        raise HTTPException(422, "O saldo bancário não pode ser ajustado em data futura.")
    digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        account = account_data(connection, organization_id, account_id)[0]
        prior = (
            connection.execute(
                text(
                    "SELECT id,account_id,payload_hash FROM bank_balance_events WHERE organization_id=:org AND request_key=:key"
                ),
                {"org": organization_id, "key": payload.request_key},
            )
            .mappings()
            .one_or_none()
        )
        if prior:
            if prior["account_id"] != account_id or prior["payload_hash"] != digest:
                raise HTTPException(409, "Esta solicitação já foi usada com outros dados.")
            return {"id": prior["id"], "repeated": True}
        movements, events = data(connection, organization_id, account_id)
        summary, _ = build_ledger(account, movements, [dict(e) for e in events])
        if payload.kind == "OPENING" and (
            summary["opening"] or any(e["kind"] == "OPENING" and not e["reversed"] for e in events)
        ):
            raise HTTPException(
                409,
                "Já existe uma referência de abertura. Use um ajuste ou estorne a abertura manual.",
            )
        if payload.kind == "ADJUSTMENT" and (
            not summary["opening"] or payload.posted_on < summary["opening"]["date"]
        ):
            raise HTTPException(
                422, "Informe a abertura primeiro e use uma data a partir da referência de saldo."
            )
        identifier = connection.scalar(
            text("""INSERT INTO bank_balance_events(organization_id,account_id,kind,posted_on,amount,reason,actor_id,request_key,payload_hash)
            VALUES(:org,:account,:kind,:posted_on,:amount,:reason,:actor,:request_key,:hash) RETURNING id"""),
            {
                **payload.model_dump(),
                "org": organization_id,
                "account": account_id,
                "reason": payload.reason.strip(),
                "actor": actor(connection),
                "hash": digest,
            },
        )
        audit(
            connection,
            organization_id,
            "bank_balance_events",
            identifier,
            "create",
            new=payload.model_dump(),
        )
        return {"id": identifier, "repeated": False}


@router.post("/{account_id}/events/{event_id}/reverse")
def reverse_event(
    organization_id: UUID, account_id: UUID, event_id: UUID, payload: Reversal, request: Request
):
    if len(payload.reason.strip()) < 3:
        raise HTTPException(422, "Informe o motivo do estorno.")
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        account_data(connection, organization_id, account_id)
        event = (
            connection.execute(
                text(
                    "SELECT * FROM bank_balance_events WHERE id=:id AND organization_id=:org AND account_id=:account"
                ),
                {"id": event_id, "org": organization_id, "account": account_id},
            )
            .mappings()
            .one_or_none()
        )
        if not event:
            raise HTTPException(404, "Registro de saldo não encontrado.")
        if connection.scalar(
            text("SELECT 1 FROM bank_balance_reversals WHERE event_id=:id"), {"id": event_id}
        ):
            return {"reversed": True, "repeated": True}
        identifier = connection.scalar(
            text(
                "INSERT INTO bank_balance_reversals(event_id,reason,actor_id) VALUES(:id,:reason,:actor) RETURNING id"
            ),
            {"id": event_id, "reason": payload.reason.strip(), "actor": actor(connection)},
        )
        audit(
            connection,
            organization_id,
            "bank_balance_reversals",
            identifier,
            "reverse",
            old=dict(event),
            new={"reason": payload.reason},
        )
        return {"reversed": True, "repeated": False}
