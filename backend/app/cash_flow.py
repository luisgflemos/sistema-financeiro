"""Fluxo gerencial: fatos bancários, compromissos e estimativas auditáveis."""

import hashlib
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.bank_balances import account_data, build_ledger, serialize
from app.bank_balances import data as bank_data
from app.cash_forecast import ZERO, add_month, cents, learn, month, project
from app.catalog import lock_organization
from app.history_context import load_history
from app.planning import SUMMARY, NewEntry, audit, occurrence_date, present, validate_fields
from app.statements import actor

router = APIRouter(prefix="/organizations/{organization_id}/cash-flow", tags=["Gerencial"])


class CashFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: date | None = None
    end: date | None = None
    as_of: date | None = None
    account_id: UUID | None = None
    cost_center_id: UUID | None = None
    category_id: UUID | None = None
    focus_key: str | None = Field(default=None, max_length=64)


def matches(row, filters):
    return all(
        not getattr(filters, k) or str(row.get(k)) == str(getattr(filters, k))
        for k in ("account_id", "cost_center_id", "category_id")
    )


def catalogs(connection, org):
    result = {}
    for table, column in (
        ("bank_accounts", "label"),
        ("categories", "name"),
        ("cost_centers", "name"),
        ("parties", "display_name"),
    ):
        result[table] = [
            dict(r)
            for r in connection.execute(
                text(
                    f"SELECT id,{column} AS name,active FROM {table} WHERE organization_id=:org ORDER BY {column}"
                ),
                {"org": org},
            ).mappings()
        ]
    result["subcategories"] = [
        dict(r)
        for r in connection.execute(
            text(
                "SELECT s.id,s.name,s.active FROM subcategories s JOIN categories c ON c.id=s.category_id WHERE c.organization_id=:org"
            ),
            {"org": org},
        ).mappings()
    ]
    return result


def report(connection, org, filters):
    if not connection.scalar(text("SELECT 1 FROM organizations WHERE id=:org"), {"org": org}):
        raise HTTPException(404, "Organização não encontrada.")
    names = catalogs(connection, org)
    for field, table in (
        ("account_id", "bank_accounts"),
        ("cost_center_id", "cost_centers"),
        ("category_id", "categories"),
    ):
        identifier = getattr(filters, field)
        if identifier and not any(str(r["id"]) == str(identifier) for r in names[table]):
            raise HTTPException(422, "Selecione filtros desta organização.")
    accounts = [a for a in account_data(connection, org) if a["currency"] == "BRL"]
    history = load_history(connection, org)
    bank_ids = {str(a["id"]) for a in accounts}
    history = [r for r in history if str(r["account_id"]) in bank_ids]
    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    last_imported = max((r["posted_on"] for r in history if r["posted_on"] <= today), default=today)
    as_of = filters.as_of or last_imported
    if as_of > today:
        raise HTTPException(422, "A data-base não pode estar no futuro.")
    start = filters.start or as_of - timedelta(days=30)
    end = filters.end or as_of + timedelta(days=90)
    if start > end or end > add_month(as_of, 12) or (end - start).days > 730 or end <= as_of:
        raise HTTPException(
            422, "Escolha um período com projeção após a data-base e horizonte de até 12 meses."
        )
    entries = [
        present(r)
        for r in connection.execute(
            text(
                SUMMARY
                + " WHERE e.organization_id=:org AND e.deleted_at IS NULL AND NOT e.cancelled"
            ),
            {"org": org},
        ).mappings()
    ]
    entries = [e for e in entries if Decimal(e["outstanding"]) > 0]
    # Recorte como era conhecido na data-base: não usar movimentos futuros no treinamento.
    learned = [r for r in history if r["posted_on"] <= as_of]
    starts = {}
    for r in learned:
        key = str(r["account_id"])
        starts[key] = min(starts.get(key, r["posted_on"]), r["posted_on"])
    patterns = learn(learned, as_of, starts)
    decisions = {}
    for r in connection.execute(
        text(
            "SELECT DISTINCT ON (pattern_key,period) * FROM cash_projection_decisions WHERE organization_id=:org ORDER BY pattern_key,period,created_at DESC,id DESC"
        ),
        {"org": org},
    ).mappings():
        decisions[(r["pattern_key"], r["period"])] = dict(r)
    budgets, predictions = project(patterns, learned, entries, as_of, end, decisions)
    lookups = {table: {str(r["id"]): r["name"] for r in rows} for table, rows in names.items()}

    def describe(row):
        return {
            "account_name": lookups["bank_accounts"].get(
                str(row.get("account_id")), "Sem conta definida"
            ),
            "category_name": lookups["categories"].get(
                str(row.get("category_id")), "A identificar"
            ),
            "subcategory_name": lookups["subcategories"].get(
                str(row.get("subcategory_id")), "A identificar"
            ),
            "cost_center_name": lookups["cost_centers"].get(
                str(row.get("cost_center_id")), "Sem centro definido"
            ),
            "party_name": lookups["parties"].get(str(row.get("party_id"))),
        }

    selected_accounts = [
        a for a in accounts if not filters.account_id or a["id"] == filters.account_id
    ]
    movements, events = bank_data(connection, org)
    positions = []
    opening_dates = []
    bank_days = defaultdict(lambda: ZERO)
    start_balance = ZERO
    balance_known = 0
    missing = []
    for account in selected_accounts:
        summary, ledger = build_ledger(
            account,
            [r for r in movements if r["account_id"] == account["id"] and r["posted_on"] <= as_of],
            [
                dict(e)
                for e in events
                if e["account_id"] == account["id"] and e["posted_on"] <= as_of
            ],
        )
        positions.append(
            {k: summary[k] for k in ("account_id", "label", "calculated_balance", "as_of", "state")}
        )
        if summary["calculated_balance"] is None:
            missing.append(account["label"])
            continue
        balance_known += 1
        opening_dates.append(summary["opening"]["date"])
        start_balance += summary["calculated_balance"]
        for r in ledger:
            if r["calculated_balance"] is not None:
                bank_days[r["posted_on"]] += r["signed_amount"]
    filtered = bool(filters.cost_center_id or filters.category_id)
    anchor = None if filtered or not balance_known else start_balance
    daily = {}
    effective_start = min(start, as_of + timedelta(days=1))
    for i in range((end - effective_start).days + 1):
        day = effective_start + timedelta(days=i)
        daily[day] = {
            "date": day,
            **{
                f"{layer}_{side}": ZERO
                for layer in ("realized", "registered", "forecast")
                for side in ("credit", "debit")
            },
            "neutral_net": ZERO,
            "balance": None,
        }
    items = []
    pending_amount = ZERO
    for r in history:
        day = r["posted_on"]
        if not matches(r, filters) or day < start or day > min(end, as_of):
            continue
        kind = r.get("movement_kind") or "NORMAL"
        neutral = kind in ("INTERNAL_TRANSFER", "AUTOMATIC_PROCESS")
        if neutral:
            daily[day]["neutral_net"] += r["amount"] * (1 if r["direction"] == "CREDIT" else -1)
        else:
            daily[day]["realized_" + r["direction"].lower()] += r["amount"]
        if not r.get("method"):
            pending_amount += r["amount"]
        items.append(
            {
                "id": str(r["source_transaction_id"]),
                "date": day,
                "layer": "realized",
                "amount": r["amount"],
                "direction": r["direction"],
                "description": r["raw_description"],
                "neutral": neutral,
                "pending": not bool(r.get("method")),
                **describe(r),
            }
        )
    overdue = []
    for e in entries:
        if not matches(e, filters):
            continue
        item = {
            "id": str(e["id"]),
            "date": e["due_on"],
            "amount": Decimal(e["outstanding"]),
            "layer": "registered",
            "direction": e["direction"],
            "description": e["description"],
            **describe(e),
        }
        if e["due_on"] <= as_of:
            overdue.append(item)
        elif effective_start <= e["due_on"] <= end:
            if e["due_on"] >= start:
                items.append(item)
            daily[e["due_on"]]["registered_" + e["direction"].lower()] += item["amount"]
    for p in predictions:
        if effective_start <= p["date"] <= end and matches(p, filters):
            item = {**p, "id": p["pattern_key"] + str(p["date"]), **describe(p)}
            item["description"] = "Estimativa · " + item["subcategory_name"]
            if p["date"] >= start:
                items.append(item)
            daily[p["date"]]["forecast_" + p["direction"].lower()] += p["amount"]
    # Cada dia passado usa a variação bancária; o futuro usa compromissos + estimativas.
    running = anchor
    if running is not None:
        running -= sum((v for d, v in bank_days.items() if start <= d <= as_of), ZERO)
    for day, line in daily.items():
        if running is not None:
            if day <= as_of:
                running += bank_days[day]
            else:
                running += (
                    line["registered_credit"]
                    + line["forecast_credit"]
                    - line["registered_debit"]
                    - line["forecast_debit"]
                )
            line["balance"] = (
                cents(running) if not opening_dates or day >= max(opening_dates) else None
            )
    rows = [line for day, line in daily.items() if day >= start]
    monthly = {}
    for line in rows:
        m = month(line["date"])
        target = monthly.setdefault(
            m,
            {**{k: ZERO for k in line if k not in ("date", "balance")}, "date": m, "balance": None},
        )
        for k in target:
            if k not in ("date", "balance"):
                target[k] += line[k]
        target["balance"] = line["balance"]
    public_budgets = []
    for b in budgets:
        if not matches(b["dimensions"], filters):
            continue
        why = f"{b['observed_months']} de {b['months']} meses recentes com movimento. Média ponderada R$ {b['base']:.2f}; tendência {cents((b['trend'] - 1) * 100):.2f}%; fator sazonal {b['seasonal']:.2f}."
        public_budgets.append(
            {
                **{
                    k: b[k]
                    for k in (
                        "key",
                        "period",
                        "target",
                        "actual",
                        "registered",
                        "remaining",
                        "projected",
                        "confidence",
                        "observed_months",
                        "months",
                        "last_seen",
                        "revision",
                        "excluded",
                        "manual",
                        "unscheduled",
                    )
                },
                **b["dimensions"],
                **describe(b["dimensions"]),
                "reason": why,
                "timing": "Distribuição histórica por dia da semana"
                if b["frequent"]
                else f"Dia habitual {b['typical_day']}",
            }
        )
    warnings = [
        "Estimativas dependem da completude do histórico e não são garantia de recebimento ou pagamento."
    ]
    if missing:
        warnings.append("Saldo parcial: sem referência para " + ", ".join(missing) + ".")
    if filtered:
        warnings.append(
            "Centro de custos/classificação não têm saldo bancário próprio. Exibindo fluxos, sem saldo de conta atribuído."
        )
    if any(p["state"] != "consistent" for p in positions if p["calculated_balance"] is not None):
        warnings.append("Há posições bancárias com ajustes ou necessidade de conferência.")
    if any(p["as_of"] and p["as_of"] < as_of for p in positions):
        warnings.append(
            "As contas têm datas de última movimentação diferentes; confira se os extratos estão completos até a data-base."
        )
    if pending_amount:
        warnings.append(
            f"Há R$ {pending_amount:.2f} em movimentos ainda não identificados no período. Não treinam projeções."
        )
    if overdue:
        warnings.append(
            "Títulos vencidos estão separados: falta definir quando serão recebidos ou pagos. Não foram somados ao saldo futuro."
        )
    if any(not e.get("account_id") for e in entries) and filters.account_id:
        warnings.append(
            "Há compromissos sem conta definida, presentes apenas na visão consolidada. Não foram atribuídos a esta conta."
        )
    totals = (
        {k: sum((r[k] for r in rows), ZERO) for k in rows[0] if k not in ("date", "balance")}
        if rows
        else {}
    )
    return {
        "as_of": as_of,
        "start": start,
        "end": end,
        "history_scanned": len(history),
        "training_records": sum(
            r.get("method") in ("OPERATOR", "AI_CONFIRMED") and r.get("movement_kind") == "NORMAL"
            for r in learned
        ),
        "anchor": anchor,
        "known_accounts": balance_known,
        "total_accounts": len(selected_accounts),
        "positions": positions,
        "warnings": warnings,
        "totals": totals,
        "closing": rows[-1]["balance"] if rows else anchor,
        "daily": rows,
        "monthly": list(monthly.values()),
        "patterns": public_budgets,
        "items": items,
        "overdue": overdue,
        "catalogs": names,
    }


@router.get("")
def get_report(
    organization_id: UUID,
    request: Request,
    start: date | None = None,
    end: date | None = None,
    as_of: date | None = None,
    account_id: UUID | None = None,
    cost_center_id: UUID | None = None,
    category_id: UUID | None = None,
):
    filters = CashFilters(
        start=start,
        end=end,
        as_of=as_of,
        account_id=account_id,
        cost_center_id=cost_center_id,
        category_id=category_id,
    )
    with request.app.state.database.connect() as connection:
        if not connection.in_transaction():
            connection.execution_options(isolation_level="REPEATABLE READ")
        return serialize(report(connection, organization_id, filters))


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filters: CashFilters
    key: str = Field(min_length=64, max_length=64)
    period: date
    expected_revision: str = Field(min_length=64, max_length=64)
    action: Literal["ADJUST", "EXCLUDE", "RESET"]
    amount: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=2)
    reason: str = Field(min_length=3, max_length=1000)
    request_key: UUID


@router.post("/decisions", status_code=201)
def decide(organization_id: UUID, payload: Decision, request: Request):
    if len(payload.reason.strip()) < 3 or (payload.action == "ADJUST" and payload.amount is None):
        raise HTTPException(422, "Informe valor e justificativa da revisão.")
    digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        prior = (
            connection.execute(
                text(
                    "SELECT payload_hash FROM cash_projection_decisions WHERE organization_id=:org AND request_key=:key"
                ),
                {"org": organization_id, "key": payload.request_key},
            )
            .mappings()
            .first()
        )
        if prior:
            if prior["payload_hash"] != digest:
                raise HTTPException(409, "Esta solicitação já foi usada com outros dados.")
            return {"repeated": True}
        current = report(connection, organization_id, payload.filters)
        pattern = next(
            (
                p
                for p in current["patterns"]
                if p["key"] == payload.key and p["period"] == payload.period
            ),
            None,
        )
        if not pattern or pattern["revision"] != payload.expected_revision:
            raise HTTPException(
                409, "A projeção mudou. Atualize e revise os valores antes de salvar."
            )
        identifier = connection.scalar(
            text(
                "INSERT INTO cash_projection_decisions(organization_id,pattern_key,period,action,amount,reason,request_key,payload_hash,actor_id) VALUES(:org,:pattern,:period,:action,:amount,:reason,:key,:hash,:actor) RETURNING id"
            ),
            {
                "org": organization_id,
                "pattern": payload.key,
                "period": payload.period,
                "action": payload.action,
                "amount": payload.amount,
                "reason": payload.reason.strip(),
                "key": payload.request_key,
                "hash": digest,
                "actor": actor(connection),
            },
        )
        audit(
            connection,
            organization_id,
            "cash_projection_decisions",
            identifier,
            "create",
            new=payload.model_dump(),
        )
    return {"id": identifier, "repeated": False}


class Conversion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filters: CashFilters
    key: str = Field(min_length=64, max_length=64)
    period: date
    expected_revision: str = Field(min_length=64, max_length=64)
    due_on: date
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    frequency: Literal["ONCE", "MONTHLY"] = "ONCE"
    occurrences: int = Field(default=1, ge=1, le=12)
    request_key: UUID


@router.post("/convert", status_code=201)
def convert(organization_id: UUID, payload: Conversion, request: Request):
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
            .first()
        )
        if prior:
            if prior["payload_hash"] != digest:
                raise HTTPException(409, "Esta solicitação já foi usada com outros dados.")
            return {"created": payload.occurrences, "repeated": True}
        current = report(connection, organization_id, payload.filters)
        pattern = next(
            (
                p
                for p in current["patterns"]
                if p["key"] == payload.key and p["period"] == payload.period
            ),
            None,
        )
        if not pattern or pattern["revision"] != payload.expected_revision or pattern["excluded"]:
            raise HTTPException(409, "A projeção mudou. Atualize antes de criar o lançamento.")
        if payload.due_on > add_month(current["as_of"], 12):
            raise HTTPException(422, "Escolha vencimento dentro dos próximos 12 meses.")
        if payload.due_on <= current["as_of"] or (
            payload.frequency == "ONCE" and payload.occurrences != 1
        ):
            raise HTTPException(422, "Revise vencimento e quantidade de ocorrências.")
        entry = NewEntry(
            description="Previsão confirmada — " + pattern["subcategory_name"],
            due_on=payload.due_on,
            direction=pattern["direction"],
            expected_amount=payload.amount,
            account_id=pattern["account_id"],
            category_id=pattern["category_id"],
            subcategory_id=pattern["subcategory_id"],
            cost_center_id=pattern["cost_center_id"],
            notes="Criado por confirmação de projeção do Fin.",
            request_key=payload.request_key,
            frequency=payload.frequency,
            occurrences=payload.occurrences,
        )
        validate_fields(connection, organization_id, entry)
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
        for index in range(entry.occurrences):
            due = occurrence_date(entry.due_on, entry.frequency, index)
            connection.execute(
                text("""INSERT INTO planned_entries(organization_id,series_id,occurrence,occurrences,frequency,description,due_on,direction,expected_amount,account_id,category_id,subcategory_id,cost_center_id,party_id,notes)
                VALUES(:org,:series,:occurrence,:occurrences,:frequency,:description,:due_on,:direction,:expected_amount,:account_id,:category_id,:subcategory_id,:cost_center_id,:party_id,:notes)"""),
                {
                    **entry.model_dump(),
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
            "create_from_forecast",
            new=payload.model_dump(),
        )
        return {"created": entry.occurrences, "repeated": False}
