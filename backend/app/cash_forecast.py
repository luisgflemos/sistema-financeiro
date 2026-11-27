"""Projeções explicáveis por grupos, separadas de compromissos e do banco."""

import calendar
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0.00")
ONE = Decimal(1)
CENT = Decimal(".01")
DIMS = ("account_id", "direction", "category_id", "subcategory_id", "cost_center_id")


def month(day):
    return day.replace(day=1)


def add_month(day, count):
    year, offset = divmod(day.year * 12 + day.month - 1 + count, 12)
    return date(year, offset + 1, min(day.day, calendar.monthrange(year, offset + 1)[1]))


def months(first, last):
    current = month(first)
    while current <= month(last):
        yield current
        current = add_month(current, 1)


def cents(value):
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def key_of(row):
    return tuple(str(row.get(k) or "") for k in DIMS)


def pattern_key(key):
    return hashlib.sha256("|".join(key).encode()).hexdigest()


def weighted(values):
    return sum((v * (i + 1) for i, v in enumerate(values)), ZERO) / sum(range(1, len(values) + 1))


def clamp(value, lower, upper):
    return max(Decimal(lower), min(Decimal(upper), value))


def distribute(amount, days, weights):
    """Inteiros em centavos; maior resto, desempate cronológico determinístico."""
    total = sum(weights, ZERO)
    if not days or total <= 0 or amount <= 0:
        return []
    units = int(cents(amount) * 100)
    exact = [Decimal(units) * w / total for w in weights]
    values = [int(n) for n in exact]
    rest = units - sum(values)
    for index in sorted(range(len(days)), key=lambda i: (-(exact[i] - values[i]), days[i]))[:rest]:
        values[index] += 1
    return [(d, Decimal(v) / 100) for d, v in zip(days, values, strict=True) if v]


def learn(history, as_of, account_starts):
    groups = defaultdict(list)
    for row in history:
        if (
            row.get("method") in ("OPERATOR", "AI_CONFIRMED")
            and row.get("movement_kind") == "NORMAL"
            and row.get("category_id")
            and row.get("subcategory_id")
            and row.get("cost_center_id")
            and row["posted_on"] <= as_of
        ):
            groups[key_of(row)].append(row)
    patterns = []
    for key, rows in sorted(groups.items()):
        first = max(month(account_starts[key[0]]), add_month(month(as_of), -6))
        complete = list(months(first, add_month(month(as_of), -1)))
        totals = {
            m: sum((r["amount"] for r in rows if month(r["posted_on"]) == m), ZERO)
            for m in complete
        }
        observed = sum(v > 0 for v in totals.values())
        last_seen = max(r["posted_on"] for r in rows)
        if len(complete) < 3 or observed < 3 or (as_of - last_seen).days > 90:
            continue
        values = list(totals.values())
        base = weighted(values)
        old, recent = values[:-3], values[-3:]
        trend = (
            clamp((sum(recent, ZERO) / len(recent)) / (sum(old, ZERO) / len(old)), ".70", "1.30")
            if old and sum(old, ZERO)
            else ONE
        )
        # A média recente já captura a direção; amortecer a extrapolação.
        trend = ONE + (trend - ONE) / 2
        deviation = sum((abs(v - base) for v in values), ZERO) / len(values) / base if base else ONE
        confidence = "high" if observed >= 6 and deviation <= Decimal(".20") else "medium"
        recent_rows = [r for r in rows if first <= r["posted_on"] < month(as_of)]
        count_per_month = Decimal(len(recent_rows)) / len(complete)
        days = sorted(r["posted_on"].day for r in recent_rows)
        typical_day = days[len(days) // 2]
        weekdays = [
            sum((r["amount"] for r in recent_rows if r["posted_on"].weekday() == w), ZERO)
            for w in range(7)
        ]
        annual = defaultdict(list)
        for m in months(min(r["posted_on"] for r in rows), add_month(month(as_of), -1)):
            annual[m.month].append(
                sum((r["amount"] for r in rows if month(r["posted_on"]) == m), ZERO)
            )
        patterns.append(
            {
                "key": pattern_key(key),
                "dimensions": dict(zip(DIMS, key, strict=True)),
                "base": cents(base),
                "trend": trend,
                "confidence": confidence,
                "observed_months": observed,
                "months": len(complete),
                "last_seen": last_seen,
                "deviation": cents(deviation * 100),
                "typical_day": typical_day,
                "frequent": count_per_month > 3,
                "weekdays": weekdays,
                "annual": dict(annual),
            }
        )
    return patterns


def project(patterns, history, entries, as_of, until, decisions):
    budgets = []
    for pattern in patterns:
        dims = pattern["dimensions"]
        for period in months(as_of + timedelta(days=1), until):
            annual = pattern["annual"].get(period.month, [])
            all_annual = [v for values in pattern["annual"].values() for v in values]
            seasonal = ONE
            if len(annual) >= 2 and sum(all_annual, ZERO) > 0:
                seasonal = clamp(
                    (sum(annual, ZERO) / len(annual)) / (sum(all_annual, ZERO) / len(all_annual)),
                    ".50",
                    "1.50",
                )
                seasonal = ONE + (seasonal - ONE) / 2
            target = cents(pattern["base"] * pattern["trend"] * seasonal)
            decision = decisions.get((pattern["key"], period))
            if decision and decision["action"] == "ADJUST":
                target = decision["amount"]
            actual = sum(
                (
                    r["amount"]
                    for r in history
                    if key_of(r) == tuple(dims[k] for k in DIMS)
                    and month(r["posted_on"]) == period
                    and r["posted_on"] <= as_of
                    and r.get("movement_kind") == "NORMAL"
                ),
                ZERO,
            )
            budgets.append(
                {
                    **pattern,
                    "period": period,
                    "target": target,
                    "seasonal": seasonal,
                    "actual": actual,
                    "registered": ZERO,
                    "remaining": max(ZERO, target - actual),
                    "excluded": bool(decision and decision["action"] == "EXCLUDE"),
                    "manual": bool(decision and decision["action"] != "RESET"),
                }
            )
    # Cada compromisso cobre uma única vez a estimativa compatível, inclusive sem conta/centro.
    for entry in sorted(entries, key=lambda e: (str(e["due_on"]), str(e["id"]))):
        remaining = Decimal(entry["outstanding"])
        for budget in budgets:
            dims = budget["dimensions"]
            if (
                month(entry["due_on"]) != budget["period"]
                or entry["direction"] != dims["direction"]
            ):
                continue
            if any(
                entry.get(k) and str(entry[k]) != dims[k]
                for k in ("account_id", "category_id", "subcategory_id", "cost_center_id")
            ):
                continue
            cover = min(remaining, budget["remaining"])
            budget["registered"] += cover
            budget["remaining"] -= cover
            remaining -= cover
            if remaining <= 0:
                break
    items = []
    for budget in budgets:
        period = budget["period"]
        # Distribuir o mês inteiro antes do recorte da janela, sem concentrar valores no último dia.
        first = max(period, as_of + timedelta(days=1))
        last = add_month(period, 1) - timedelta(days=1)
        if budget["frequent"]:
            days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
            weights = [budget["weekdays"][d.weekday()] for d in days]
            if not sum(weights, ZERO):
                weights = [ONE] * len(days)
        else:
            due = date(period.year, period.month, min(budget["typical_day"], last.day))
            # Despesa habitual já esperada no passado não vira vencimento inventado amanhã.
            days = [due] if due >= first else []
            weights = [ONE] if days else []
        budget["unscheduled"] = not days and budget["remaining"] > 0 and not budget["excluded"]
        allocation = [] if budget["excluded"] else distribute(budget["remaining"], days, weights)
        for due, amount in allocation:
            if due <= until:
                items.append(
                    {
                        "date": due,
                        "amount": amount,
                        "layer": "forecast",
                        "pattern_key": budget["key"],
                        "period": period,
                        **budget["dimensions"],
                        "confidence": budget["confidence"],
                    }
                )
        budget["projected"] = sum((amount for due, amount in allocation if due <= until), ZERO)
        signature_data = {
            k: budget[k]
            for k in (
                "key",
                "period",
                "target",
                "actual",
                "registered",
                "remaining",
                "excluded",
                "last_seen",
                "base",
                "trend",
                "seasonal",
            )
        }
        budget["revision"] = hashlib.sha256(
            json.dumps(signature_data, default=str, sort_keys=True).encode()
        ).hexdigest()
    return budgets, items
