"""Carga inicial identificada em lote atômico, sem criar ou editar cadastros."""

import json
from collections import defaultdict
from decimal import Decimal
from hashlib import sha256
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.historical_parser import financial_digest, normalize, parse_historical
from app.statements import actor

router = APIRouter(prefix="/organizations/{organization_id}/historical-import", tags=["Histórico"])
VERSION = "identified-history-v1"


class HistoricalUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_name: str = Field(min_length=1, max_length=250)
    content: str = Field(max_length=28 * 1024 * 1024)
    token: str | None = Field(default=None, max_length=64)


def index(rows, key):
    result = defaultdict(list)
    for row in rows:
        result[normalize(row[key])].append(dict(row))
    return result


def resolve(options, name, row_number, label):
    matches = options.get(normalize(name), [])
    if len(matches) != 1 or not matches[0]["active"]:
        raise HTTPException(
            422,
            f"Linha {row_number}: {label} '{name}' não encontrado, inativo ou ambíguo. Nenhum cadastro será criado automaticamente.",
        )
    return matches[0]


def build_preview(connection, organization_id, payload):
    try:
        raw, sheet_name, source_rows = parse_historical(payload.file_name, payload.content)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    params = {"org": organization_id}
    accounts = index(
        connection.execute(
            text("SELECT * FROM bank_accounts WHERE organization_id=:org"), params
        ).mappings(),
        "label",
    )
    categories = index(
        connection.execute(
            text("SELECT * FROM categories WHERE organization_id=:org"), params
        ).mappings(),
        "name",
    )
    centers = index(
        connection.execute(
            text("SELECT * FROM cost_centers WHERE organization_id=:org"), params
        ).mappings(),
        "name",
    )
    subs = defaultdict(list)
    for sub in connection.execute(
        text(
            "SELECT s.* FROM subcategories s JOIN categories c ON c.id=s.category_id WHERE c.organization_id=:org"
        ),
        params,
    ).mappings():
        subs[(str(sub["category_id"]), normalize(sub["name"]))].append(dict(sub))
    aliases = defaultdict(dict)
    for sub in connection.execute(
        text("""
        SELECT s.*, e.old_json->>'name' AS former_name FROM subcategories s
        JOIN categories c ON c.id=s.category_id JOIN audit_events e ON e.entity_id=s.id
        WHERE c.organization_id=:org AND e.organization_id=:org
        AND e.entity_type='subcategories' AND e.old_json->>'name' IS NOT NULL
        AND e.old_json->>'category_id'=CAST(s.category_id AS text)
    """),
        params,
    ).mappings():
        aliases[(str(sub["category_id"]), normalize(sub["former_name"]))][str(sub["id"])] = dict(
            sub
        )
    renamed = {}
    grouped = defaultdict(list)
    for source in source_rows:
        number = source["row"]
        account = resolve(accounts, source["account"], number, "conta")
        if account["currency"] != "BRL":
            raise HTTPException(422, f"Linha {number}: a conta precisa usar BRL.")
        category = resolve(categories, source["category"], number, "classificação")
        sub_key = (str(category["id"]), normalize(source["subcategory"]))
        proven = {str(s["id"]): s for s in subs[sub_key]}
        proven.update(aliases[sub_key])
        sub_matches = list(proven.values())
        if len(sub_matches) != 1 or not sub_matches[0]["active"]:
            raise HTTPException(
                422,
                f"Linha {number}: subclassificação não encontrada, inativa ou ambígua nesta classificação.",
            )
        if normalize(sub_matches[0]["name"]) != normalize(source["subcategory"]):
            renamed_key = (str(category["id"]), str(sub_matches[0]["id"]), source["subcategory"])
            if renamed_key not in renamed:
                renamed[renamed_key] = {
                    "category": category["name"],
                    "source": source["subcategory"],
                    "current": sub_matches[0]["name"],
                    "count": 0,
                }
            renamed[renamed_key]["count"] += 1
        transfer = normalize(source["category"]) == "transferencia bancaria"
        expected_kind = (
            "NEUTRAL" if transfer else "REVENUE" if source["direction"] == "CREDIT" else "EXPENSE"
        )
        if category["kind"] != expected_kind:
            raise HTTPException(
                422,
                f"Linha {number}: classificação incompatível com o crédito/débito ou transferência própria.",
            )
        center = (
            resolve(centers, source["cost_center"], number, "centro de custos")
            if source["cost_center"]
            else None
        )
        if not transfer and center is None:
            raise HTTPException(422, f"Linha {number}: informe o centro de custos.")
        grouped[str(account["id"])].append(
            {
                **source,
                "account_id": str(account["id"]),
                "account_label": account["label"],
                "category_id": str(category["id"]),
                "subcategory_id": str(sub_matches[0]["id"]),
                "cost_center_id": str(center["id"]) if center else None,
                "movement_kind": "INTERNAL_TRANSFER" if transfer else "NORMAL",
            }
        )
    groups, summaries, existing_ids = [], [], []
    for account_id, rows in sorted(grouped.items()):
        digest = financial_digest(rows)
        existing = (
            connection.execute(
                text(
                    "SELECT id, parser_version FROM import_files WHERE bank_account_id=:account AND sha256=:digest"
                ),
                {"account": account_id, "digest": digest},
            )
            .mappings()
            .one_or_none()
        )
        if existing and existing["parser_version"] != VERSION:
            raise HTTPException(409, "O identificador da carga conflita com outra importação.")
        if existing:
            existing_ids.append(str(existing["id"]))
        summary = {
            "account_id": account_id,
            "account_label": rows[0]["account_label"],
            "count": len(rows),
            "period_start": min(r["posted_on"] for r in rows),
            "period_end": max(r["posted_on"] for r in rows),
            "credits": f"{sum((Decimal(r['amount']) for r in rows if r['direction'] == 'CREDIT'), Decimal(0)):.2f}",
            "debits": f"{sum((Decimal(r['amount']) for r in rows if r['direction'] == 'DEBIT'), Decimal(0)):.2f}",
            "transfers": sum(r["movement_kind"] == "INTERNAL_TRANSFER" for r in rows),
            "repeated": bool(existing),
            "digest": digest,
        }
        groups.append((summary, rows, existing_ids[-1] if existing else None))
        summaries.append(summary)
    # Carga inicial não se sobrepõe silenciosamente a extratos já lançados.
    other = connection.scalar(
        text("""
        SELECT count(*) FROM bank_transactions t JOIN bank_accounts a ON a.id=t.account_id
        WHERE a.organization_id=:org AND t.import_file_id<>ALL(CAST(:existing AS uuid[]))
    """),
        {"org": organization_id, "existing": existing_ids},
    )
    if other:
        raise HTTPException(
            409,
            "A carga histórica inicial requer o histórico vazio ou a repetição exata da base já importada. Existem outros movimentos; nenhum registro foi alterado.",
        )
    source_hash = sha256(raw).hexdigest()
    token = sha256(
        json.dumps(
            {
                "source": source_hash,
                "groups": summaries,
                "bindings": [
                    [r["category_id"], r["subcategory_id"], r["cost_center_id"], r["movement_kind"]]
                    for _, rows, _ in groups
                    for r in rows
                ],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return (
        {
            "sheet": sheet_name,
            "count": len(source_rows),
            "new": sum(s["count"] for s in summaries if not s["repeated"]),
            "credits": f"{sum((Decimal(s['credits']) for s in summaries), Decimal(0)):.2f}",
            "debits": f"{sum((Decimal(s['debits']) for s in summaries), Decimal(0)):.2f}",
            "groups": summaries,
            "token": token,
            "source_sha256": source_hash,
            "preserves_equal_rows": True,
            "catalogs_changed": False,
            "renamed_subcategories": list(renamed.values()),
        },
        raw,
        groups,
    )


@router.post("/preview")
def preview(organization_id: UUID, payload: HistoricalUpload, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        result, _, _ = build_preview(connection, organization_id, payload)
        return result


@router.post("/commit")
def commit(organization_id: UUID, payload: HistoricalUpload, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        result, raw, groups = build_preview(connection, organization_id, payload)
        if payload.token != result["token"]:
            raise HTTPException(409, "A prévia mudou. Confira novamente antes de importar.")
        if not result["new"]:
            return {
                "imported": 0,
                "repeated": True,
                "file_ids": [existing for _, _, existing in groups],
                "summary": result,
            }
        actor_id = actor(connection)
        batch = uuid4()
        connection.execute(
            text(
                "INSERT INTO import_batches(id, organization_id, imported_by, status) VALUES (:id,:org,:actor,'COMMITTED')"
            ),
            {"id": batch, "org": organization_id, "actor": actor_id},
        )
        file_ids = []
        for summary, rows, existing in groups:
            if existing:
                file_ids.append(existing)
                continue
            file_id = uuid4()
            file_ids.append(str(file_id))
            connection.execute(
                text("""
                INSERT INTO import_files(id, organization_id, batch_id, bank_account_id, file_name,
                    sha256, format, storage_key, period_start, period_end, parser_version)
                VALUES (:id,:org,:batch,:account,:name,:digest,'XLSX',:storage,:start,:end,:parser)
            """),
                {
                    "id": file_id,
                    "org": organization_id,
                    "batch": batch,
                    "account": summary["account_id"],
                    "name": payload.file_name,
                    "digest": summary["digest"],
                    "storage": "database:historical:" + result["source_sha256"],
                    "start": summary["period_start"],
                    "end": summary["period_end"],
                    "parser": VERSION,
                },
            )
            connection.execute(
                text(
                    "INSERT INTO statement_contents(import_file_id, original_bytes) VALUES (:file,:raw)"
                ),
                {"file": file_id, "raw": raw},
            )
            for offset in range(0, len(rows), 1000):
                chunk = [
                    {
                        **r,
                        "source_row": r["row"],
                        "id": str(uuid4()),
                        "identification_id": str(uuid4()),
                        "raw_payload": {
                            "data": r["posted_on"],
                            "historico": r["description"],
                            "documento": r["document"],
                            "valor": ("-" if r["direction"] == "DEBIT" else "") + r["amount"],
                            "saldo": None,
                            "source_kind": "identified_history",
                            "source_sha256": result["source_sha256"],
                            "source_sheet": result["sheet"],
                            "source_row": r["row"],
                            "lfd": r["lfd"],
                            "original_columns": r["source"],
                        },
                    }
                    for r in rows[offset : offset + 1000]
                ]
                params = {
                    "rows": json.dumps(chunk, default=str),
                    "file": file_id,
                    "org": organization_id,
                    "actor": actor_id,
                }
                connection.execute(
                    text("""
                    INSERT INTO bank_transactions(id,account_id,import_file_id,source_row,posted_on,direction,amount,currency,raw_description,raw_payload,fingerprint)
                    SELECT r.id, r.account_id, :file, r.source_row, r.posted_on, r.direction, r.amount,'BRL',r.description,r.raw_payload,r.fingerprint
                    FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(id uuid,account_id uuid,source_row integer,posted_on date,direction text,amount numeric,description text,raw_payload jsonb,fingerprint text)
                """),
                    params,
                )
                connection.execute(
                    text("""
                    INSERT INTO statement_rows(import_file_id,source_row,transaction_id,decision,original_data)
                    SELECT :file,r.source_row,r.id,'new',jsonb_build_object('posted_on',r.posted_on,'description',r.description,'document',r.document,'direction',r.direction,'amount',r.amount,'balance',NULL,'reason','Histórico identificado validado pelo usuário')
                    FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(id uuid,source_row integer,posted_on text,description text,document text,direction text,amount text)
                """),
                    params,
                )
                connection.execute(
                    text("""
                    INSERT INTO transaction_identifications(id,transaction_id,organization_id,version,category_id,subcategory_id,cost_center_id,movement_kind,method,actor_id)
                    SELECT r.identification_id,r.id,:org,1,r.category_id,r.subcategory_id,r.cost_center_id,r.movement_kind,'OPERATOR',:actor
                    FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(id uuid,identification_id uuid,category_id uuid,subcategory_id uuid,cost_center_id uuid,movement_kind text)
                """),
                    params,
                )
        connection.execute(
            text("""
            INSERT INTO audit_events(organization_id,actor_id,entity_type,entity_id,action,new_json)
            VALUES (:org,:actor,'import_batches',:batch,'historical_identified_import',CAST(:summary AS jsonb))
        """),
            {
                "org": organization_id,
                "actor": actor_id,
                "batch": batch,
                "summary": json.dumps(
                    {**result, "file_ids": file_ids, "all_equal_occurrences_preserved": True}
                ),
            },
        )
        return {
            "imported": result["new"],
            "repeated": False,
            "file_ids": file_ids,
            "summary": result,
        }


@router.get("/summary")
def imported_summary(organization_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        rows = connection.execute(
            text("""
            SELECT a.label AS account_label, count(*) AS count,
                sum(CASE WHEN t.direction='CREDIT' THEN t.amount ELSE 0 END)::text AS credits,
                sum(CASE WHEN t.direction='DEBIT' THEN t.amount ELSE 0 END)::text AS debits,
                count(i.id) AS identified, min(t.posted_on) AS period_start,max(t.posted_on) AS period_end
            FROM bank_transactions t JOIN import_files f ON f.id=t.import_file_id
            JOIN bank_accounts a ON a.id=t.account_id
            LEFT JOIN transaction_identifications i ON i.transaction_id=t.id AND i.version=1
            WHERE a.organization_id=:org AND f.parser_version=:version GROUP BY a.label ORDER BY a.label
        """),
            {"org": organization_id, "version": VERSION},
        ).mappings()
        return [dict(row) for row in rows]
