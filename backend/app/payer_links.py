"""Associações históricas explícitas: só cliente, sem reclassificar o extrato."""

import base64
import binascii
import csv
import io
import json
import re
import unicodedata
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.historical_parser import normalize
from app.statements import actor
from app.transactions import IDENT_FIELDS, LATEST, Identification, save_identification

router = APIRouter(prefix="/organizations/{organization_id}/payer-links", tags=["Histórico"])


def payer_key(value):
    return " ".join(
        re.sub(
            r"[^A-Z0-9 ]",
            "",
            unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().upper(),
        ).split()
    )


def payer_name(description):
    value = re.sub(
        r"^(?:TRANSFERENCIA\s+PIX\s+REM\s*:?|PIX\s+RECEBIDO\s*:?|RECEBIMENTO\s+PIX\s*:?|PIX\s+RECEB\s*:?)[\s-]*",
        "",
        description.strip(),
        flags=re.I,
    )
    value = re.sub(
        r"^(?:TED\s+RECEBIDA|TRANSF\s+CC\s+PARA\s+CC\s+PJ|TRANSFERENCIA\s+ENTRE\s+CONTAS|REM\s*:)\s*",
        "",
        value,
        flags=re.I,
    )
    return re.sub(r"\s+\d{2}/\d{2}(?:/\d{2,4})?\s*$", "", value).strip()


class PayerUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_name: str = Field(min_length=1, max_length=250)
    content: str = Field(max_length=1400000)
    through: date
    token: str | None = Field(default=None, max_length=64)


def parse_links(payload):
    try:
        raw = base64.b64decode(payload.content, validate=True)
        if not payload.file_name.lower().endswith(".csv") or not raw or len(raw) > 1024 * 1024:
            raise ValueError()
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";")
        if reader.fieldnames not in (
            ["Pagador", "Cliente", "Quantidade", "Total"],
            ["Pagador", "Grupo", "Quantidade", "Total"],
        ):
            raise ValueError()
        target_kind = "group" if "Grupo" in reader.fieldnames else "client"
        links, seen = [], set()
        for row in reader:
            if len(links) >= 2000 or None in row or any(v is None for v in row.values()):
                raise ValueError()
            key = payer_key(row["Pagador"])
            row["Cliente"] = row.get("Cliente", row.get("Grupo"))
            count = int(row["Quantidade"])
            total = Decimal(row["Total"].replace(",", "."))
            if (
                not key
                or key in seen
                or not row["Cliente"].strip()
                or not 1 <= count <= 100000
                or not total.is_finite()
                or total <= 0
                or total != total.quantize(Decimal(".01"))
            ):
                raise ValueError()
            seen.add(key)
            links.append(
                {
                    **row,
                    "key": key,
                    "count": count,
                    "total": total,
                    "target_kind": target_kind,
                }
            )
        if not links:
            raise ValueError()
        return links
    except (
        ValueError,
        InvalidOperation,
        binascii.Error,
        UnicodeError,
        csv.Error,
    ) as error:
        raise HTTPException(
            422,
            "Use CSV UTF-8 separado por ponto e vírgula: Pagador;Cliente;Quantidade;Total (ou Grupo no lugar de Cliente). "
            "Informe grupos únicos, quantidade inteira e total sem separador de milhar.",
        ) from error


def prepare(connection, organization_id, payload):
    links = parse_links(payload)
    parties = defaultdict(list)
    for p in connection.execute(
        text(
            "SELECT id, display_name, customer_group_id FROM parties WHERE organization_id=:org AND active "
            "AND type IN ('CUSTOMER','BOTH')"
        ),
        {"org": organization_id},
    ).mappings():
        parties[normalize(p["display_name"])].append(dict(p))
    group_targets = defaultdict(list)
    for group in connection.execute(
        text(
            "SELECT id,name AS display_name FROM customer_groups WHERE organization_id=:org AND active"
        ),
        {"org": organization_id},
    ).mappings():
        group_targets[normalize(group["display_name"])].append(dict(group))
    records = defaultdict(list)
    rows = connection.execute(
        text(
            """
        SELECT t.id, t.posted_on, t.account_id, t.direction, t.amount, t.raw_description,
            i.version, i.party_id, i.category_id, i.subcategory_id, i.cost_center_id,
            i.movement_kind, i.notes, i.method, i.customer_group_id, p.customer_group_id AS party_current_group,
            EXISTS(SELECT 1 FROM entry_settlements e WHERE e.transaction_id=t.id) AS settled
        FROM active_bank_transactions t JOIN bank_accounts a ON a.id=t.account_id
        """
            + LATEST
            + """
        JOIN subcategories s ON s.id=i.subcategory_id
        JOIN categories c ON c.id=i.category_id AND c.id=s.category_id
        LEFT JOIN parties p ON p.id=i.party_id AND p.organization_id=a.organization_id
        WHERE a.organization_id=:org AND t.posted_on <= :through AND t.direction='CREDIT'
          AND i.movement_kind='NORMAL' AND c.kind='REVENUE'
          AND i.method IN ('OPERATOR','AI_CONFIRMED')
        ORDER BY t.id
        """
        ),
        {"org": organization_id, "through": payload.through},
    ).mappings()
    # A subclasse pode existir sob pais distintos: valide nome e relação, nunca só o UUID.
    subnames = {
        r["id"]: normalize(r["name"])
        for r in connection.execute(
            text(
                "SELECT s.id,s.name FROM subcategories s JOIN categories c ON c.id=s.category_id "
                "WHERE c.organization_id=:org"
            ),
            {"org": organization_id},
        ).mappings()
    }
    for row in rows:
        if subnames[row["subcategory_id"]] == "pix faturado":
            key = payer_key(payer_name(row["raw_description"]))
            records[key].append(dict(row))
    groups, changes, snapshot = [], [], []
    for link in links:
        is_group = link["target_kind"] == "group"
        options = (group_targets if is_group else parties)[normalize(link["Cliente"])]
        if len(options) != 1:
            raise HTTPException(
                422,
                f"Cliente ou grupo ativo não encontrado ou ambíguo: {link['Cliente']}.",
            )
        party = options[0]
        matches = records[link["key"]]
        total = sum((r["amount"] for r in matches), Decimal(0))
        if len(matches) != link["count"] or total != link["total"]:
            raise HTTPException(
                409,
                f"O grupo {link['Pagador']} não confere com a base: "
                f"{len(matches)} movimentos, total {total:.2f}. Nada foi alterado.",
            )
        existing = 0
        for record in matches:
            specific_in_group = (
                is_group and record["party_id"] and record["party_current_group"] == party["id"]
            )
            already = specific_in_group or (
                record["customer_group_id"] == party["id"]
                if is_group
                else record["party_id"] == party["id"]
            )
            conflict = (
                (record["party_id"] and not specific_in_group)
                or (record["customer_group_id"] and record["customer_group_id"] != party["id"])
                if is_group
                else (record["party_id"] and record["party_id"] != party["id"])
                or (
                    record["customer_group_id"]
                    and record["customer_group_id"] != party.get("customer_group_id")
                )
            )
            if conflict:
                raise HTTPException(
                    409,
                    f"{link['Pagador']} já possui vínculo diferente. Nada foi alterado.",
                )
            if record["settled"] and not already:
                raise HTTPException(
                    409,
                    f"{link['Pagador']} possui histórico de baixa. Revise individualmente.",
                )
            snapshot.append({**record, "target": party, "target_kind": link["target_kind"]})
            if already:
                existing += 1
            else:
                changes.append((record, party["id"], is_group))
        groups.append(
            {
                "payer": link["Pagador"],
                "client": ("Grupo: " if is_group else "") + party["display_name"],
                "count": len(matches),
                "total": str(total),
                "existing": existing,
            }
        )
    token = sha256(
        json.dumps(
            {
                "org": str(organization_id),
                "through": payload.through,
                "groups": groups,
                "records": snapshot,
            },
            default=str,
            sort_keys=True,
        ).encode()
    ).hexdigest()
    preview = {
        "groups": groups,
        "count": sum(g["count"] for g in groups),
        "new": len(changes),
        "total": str(sum((Decimal(g["total"]) for g in groups), Decimal(0))),
        "through": payload.through,
        "token": token,
    }
    return preview, changes


@router.post("/preview")
def preview(organization_id: UUID, payload: PayerUpload, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        return prepare(connection, organization_id, payload)[0]


@router.post("/commit")
def commit(organization_id: UUID, payload: PayerUpload, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        checked, changes = prepare(connection, organization_id, payload)
        if payload.token != checked["token"]:
            raise HTTPException(409, "A base mudou. Confira uma nova prévia antes de gravar.")
        for record, party_id, is_group in changes:
            values = {key: record[key] for key in (*IDENT_FIELDS, "notes")}
            values.update(
                party_id=None if is_group else party_id,
                customer_group_id=party_id if is_group else None,
                expected_version=record["version"],
            )
            save_identification(connection, organization_id, record, Identification(**values))
        batch_id = uuid4()
        connection.execute(
            text(
                "INSERT INTO audit_events(organization_id,actor_id,entity_type,entity_id,action,new_json) "
                "VALUES (:org,:actor,'payer_links',:id,'link_clients',CAST(:data AS jsonb))"
            ),
            {
                "org": organization_id,
                "actor": actor(connection),
                "id": batch_id,
                "data": json.dumps(
                    {
                        "groups": checked["groups"],
                        "linked": len(changes),
                        "through": str(payload.through),
                        "preview_token": checked["token"],
                    }
                ),
            },
        )
        # Conferência dentro da mesma transação: cada cliente deve estar na última versão.
        verified, remaining = prepare(connection, organization_id, payload)
        if remaining:
            raise HTTPException(409, "A conferência não coincidiu. O lote não foi gravado.")
        return {
            "linked": len(changes),
            "verified": verified["count"],
            "groups": verified["groups"],
        }
