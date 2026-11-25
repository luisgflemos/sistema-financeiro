"""Importação transacional de extratos, sempre vinculados à conta do cabeçalho."""

import json
import os
from collections import defaultdict
from hashlib import sha256
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.catalog import lock_organization
from app.statement_dedup import classify_rows
from app.statement_parser import digits, parse_statement

router = APIRouter(prefix="/organizations/{organization_id}/statements", tags=["Extratos"])


class StatementUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_name: str = Field(min_length=1, max_length=250)
    content: str = Field(max_length=7 * 1024 * 1024)
    account_id: UUID | None = None
    decisions: dict[str, Literal["new", "skip"]] = Field(default_factory=dict, max_length=10000)


class StatementBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    files: list[StatementUpload] = Field(min_length=1, max_length=10)
    token: str | None = Field(default=None, max_length=64)


def actor(connection):
    return connection.scalar(
        text("""
        INSERT INTO users(email, display_name) VALUES ('access@finare.invalid', :name)
        ON CONFLICT(email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id
    """),
        {"name": os.environ.get("FINARE_ACCESS_USER", "finare")},
    )


def same_account(account, statement):
    branch = digits(account.get("branch")).lstrip("0") or "0"
    number = digits(account.get("account_number")) + digits(account.get("account_digit"))
    return (
        account.get("bank_code") == "033"
        and account.get("currency") == "BRL"
        and branch == (statement.branch.lstrip("0") or "0")
        and (number.lstrip("0") or "0") == (statement.account.lstrip("0") or "0")
    )


def build_preview(connection, organization_id, payload):
    accounts = [
        dict(row)
        for row in connection.execute(
            text("""
        SELECT * FROM bank_accounts WHERE organization_id = :org
    """),
            {"org": organization_id},
        ).mappings()
    ]
    seen_files = set()
    seen = defaultdict(list)
    for row in connection.execute(
        text("""
        SELECT t.account_id, t.fingerprint, t.id, t.raw_payload FROM active_bank_transactions t
        JOIN bank_accounts a ON a.id = t.account_id WHERE a.organization_id = :org
    """),
        {"org": organization_id},
    ).mappings():
        raw = row["raw_payload"]
        seen[(str(row["account_id"]), row["fingerprint"])].append(
            {
                "id": str(row["id"]),
                "signature": raw.get("signature"),
                "previous_signature": raw.get("previous_signature"),
                "next_signature": raw.get("next_signature"),
            }
        )
    stored = {
        (str(row["bank_account_id"]), row["sha256"]): dict(row)
        for row in connection.execute(
            text("""
            SELECT DISTINCT ON (f.bank_account_id, f.sha256) f.id, f.bank_account_id,
                f.sha256, f.generation,
                EXISTS(SELECT 1 FROM statement_rows r JOIN transaction_exclusions x
                    ON x.transaction_id=r.transaction_id WHERE r.import_file_id=f.id) AS excluded
            FROM import_files f WHERE f.organization_id=:org
            ORDER BY f.bank_account_id, f.sha256, f.generation DESC
        """),
            {"org": organization_id},
        ).mappings()
    }
    provenance = {
        (str(row["import_file_id"]), row["source_row"]): dict(row)
        for row in connection.execute(
            text("""
            SELECT r.import_file_id,r.source_row,r.transaction_id,
                x.transaction_id IS NOT NULL AS excluded
            FROM statement_rows r LEFT JOIN transaction_exclusions x ON x.transaction_id=r.transaction_id
            WHERE r.import_file_id=ANY(CAST(:ids AS uuid[]))
        """),
            {"ids": [value["id"] for value in stored.values()]},
        ).mappings()
    }
    restored_refs = {}
    output, internal, total_bytes, total_rows = [], [], 0, 0
    for index, upload in enumerate(payload.files):
        try:
            statement = parse_statement(upload.file_name, upload.content)
        except ValueError as error:
            raise HTTPException(422, f"{upload.file_name}: {error}") from error
        total_bytes += len(statement.raw)
        total_rows += len(statement.movements)
        if total_bytes > 20 * 1024 * 1024 or total_rows > 10000:
            raise HTTPException(422, "O lote deve ter até 20 MB e 10.000 movimentos.")
        matches = [a for a in accounts if a["active"] and same_account(a, statement)]
        selected = next((a for a in accounts if a["id"] == upload.account_id), None)
        if upload.account_id and (
            not selected or not selected["active"] or not same_account(selected, statement)
        ):
            raise HTTPException(
                422,
                f"{upload.file_name}: a conta selecionada difere da conta do extrato ou está inativa.",
            )
        if not selected and len(matches) == 1:
            selected = matches[0]
        account_id = str(selected["id"]) if selected else None
        file_key = (account_id, statement.digest)
        prior_file = stored.get(file_key)
        reimported = bool(prior_file and prior_file["excluded"] and file_key not in seen_files)
        repeated = file_key in seen_files or bool(prior_file and not prior_file["excluded"])
        rows = [movement.public() for movement in statement.movements]
        for position, row in enumerate(rows):
            row["previous_signature"] = rows[position - 1]["signature"] if position else None
            row["next_signature"] = (
                rows[position + 1]["signature"] if position + 1 < len(rows) else None
            )
        previous = {row["fingerprint"]: seen[(account_id, row["fingerprint"])] for row in rows}
        rows = classify_rows(rows, previous, upload.decisions, repeated)
        if reimported:
            for row in rows:
                prior = provenance.get((str(prior_file["id"]), row["row"]))
                if prior is None:
                    raise HTTPException(
                        409,
                        "O arquivo anterior não possui rastreabilidade completa. Revise a importação.",
                    )
                ref = str(prior["transaction_id"]) if prior["transaction_id"] else None
                if prior["excluded"] and ref not in restored_refs:
                    row.update(
                        status="new",
                        matched_ref=None,
                        replaces_excluded_id=ref,
                        reason="Movimento excluído: será reimportado sem identificação anterior.",
                    )
                    restored_refs[ref] = f"batch:{index}:{row['row']}"
                else:
                    row.update(
                        status="duplicate",
                        matched_ref=restored_refs.get(ref, ref),
                        reason="Movimento já ativo ou anteriormente desconsiderado neste arquivo.",
                    )
        pending = sum(row["status"] == "review" for row in rows)
        for row in rows:
            if row["status"] == "new":
                seen[(account_id, row["fingerprint"])].append(
                    {
                        "id": f"batch:{index}:{row['row']}",
                        "signature": row["signature"],
                        "previous_signature": row["previous_signature"],
                        "next_signature": row["next_signature"],
                    }
                )
        seen_files.add(file_key)
        item = {
            "file_name": upload.file_name,
            **statement.summary(),
            "account_id": account_id,
            "account_label": selected["label"] if selected else None,
            "account_options": [
                {"value": str(a["id"]), "label": a["label"] or a["code"]} for a in matches
            ],
            "repeated": repeated,
            "reimported": reimported,
            "restored": sum(bool(row.get("replaces_excluded_id")) for row in rows),
            "generation": prior_file["generation"] + 1 if reimported else 1,
            "previous_import_file_id": str(prior_file["id"]) if reimported else None,
            "rows": rows,
            "pending": pending,
            "new": sum(row["status"] == "new" for row in rows),
            "duplicates": sum(row["status"] == "duplicate" for row in rows),
        }
        output.append(item)
        internal.append((upload, statement, selected, rows, repeated))
    token = sha256(json.dumps(output, sort_keys=True, default=str).encode()).hexdigest()
    return {
        "files": output,
        "token": token,
        "ready": all(item["account_id"] and not item["pending"] for item in output),
        "new": sum(item["new"] for item in output),
    }, internal


@router.post("/preview")
def preview(organization_id: UUID, payload: StatementBatch, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        result, _ = build_preview(connection, organization_id, payload)
        return result


@router.post("/commit")
def commit(organization_id: UUID, payload: StatementBatch, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        result, files = build_preview(connection, organization_id, payload)
        if not result["ready"]:
            raise HTTPException(422, "Vincule todas as contas e revise as possíveis duplicidades.")
        if not payload.token or result["token"] != payload.token:
            raise HTTPException(409, "Os dados mudaram. Confira uma nova prévia antes de importar.")
        actor_id = actor(connection)
        file_ids = []
        movement_refs = {}
        batch = connection.scalar(
            text("""
            INSERT INTO import_batches(organization_id, imported_by, status)
            VALUES (:org, :actor, 'COMMITTED') RETURNING id
        """),
            {"org": organization_id, "actor": actor_id},
        )
        for file_index, (upload, statement, account, rows, repeated) in enumerate(files):
            if repeated:
                existing_id = connection.scalar(
                    text(
                        "SELECT id FROM import_files WHERE bank_account_id=:account AND sha256=:hash ORDER BY generation DESC LIMIT 1"
                    ),
                    {"account": account["id"], "hash": statement.digest},
                )
                if existing_id:
                    file_ids.append(str(existing_id))
                continue
            file_id = connection.scalar(
                text("""
                INSERT INTO import_files(
                    organization_id, batch_id, bank_account_id, file_name, sha256, format,
                    storage_key, period_start, period_end, parser_version, generation
                ) VALUES (:org, :batch, :account, :name, :hash, :format,
                    :storage, :start, :end, 'santander-tabular-v1', :generation) RETURNING id
            """),
                {
                    "org": organization_id,
                    "batch": batch,
                    "account": account["id"],
                    "name": upload.file_name,
                    "hash": statement.digest,
                    "format": upload.file_name.rsplit(".", 1)[-1].upper(),
                    "storage": "database:" + statement.digest,
                    "start": statement.summary()["period_start"],
                    "end": statement.summary()["period_end"],
                    "generation": result["files"][file_index]["generation"],
                },
            )
            connection.execute(
                text("""
                INSERT INTO statement_contents(import_file_id, original_bytes) VALUES (:id, :raw)
            """),
                {"id": file_id, "raw": statement.raw},
            )
            file_ids.append(str(file_id))
            for row in rows:
                target = None
                if row["status"] == "new":
                    target = connection.scalar(
                        text("""
                            INSERT INTO bank_transactions(
                                account_id, import_file_id, source_row, posted_on, direction,
                                amount, currency, raw_description, raw_payload, fingerprint
                            ) VALUES (:account, :file, :row, :date, :direction, :amount, :currency,
                                :description, CAST(:raw AS jsonb), :fingerprint) RETURNING id
                        """),
                        {
                            "account": account["id"],
                            "file": file_id,
                            "row": row["row"],
                            "date": row["posted_on"],
                            "direction": row["direction"],
                            "amount": row["amount"],
                            "currency": account["currency"],
                            "description": row["description"],
                            "fingerprint": row["fingerprint"],
                            "raw": json.dumps(
                                {
                                    "data": row["posted_on"],
                                    "historico": row["description"],
                                    "documento": row["document"],
                                    "valor": ("-" if row["direction"] == "DEBIT" else "")
                                    + row["amount"],
                                    "saldo": row["balance"],
                                    "signature": row["signature"],
                                    "previous_signature": row["previous_signature"],
                                    "next_signature": row["next_signature"],
                                    "reimported_from_transaction_id": row.get(
                                        "replaces_excluded_id"
                                    ),
                                }
                            ),
                        },
                    )
                    movement_refs[f"batch:{file_index}:{row['row']}"] = target
                elif row.get("matched_ref"):
                    ref = row["matched_ref"]
                    target = movement_refs.get(ref) if ref.startswith("batch:") else UUID(ref)
                connection.execute(
                    text("""
                    INSERT INTO statement_rows(
                        import_file_id, source_row, transaction_id, decision, original_data
                    ) VALUES (:file, :row, :transaction, :decision, CAST(:data AS jsonb))
                """),
                    {
                        "file": file_id,
                        "row": row["row"],
                        "transaction": target,
                        "decision": row["status"],
                        "data": json.dumps(
                            {
                                key: row[key]
                                for key in (
                                    "posted_on",
                                    "description",
                                    "document",
                                    "direction",
                                    "amount",
                                    "balance",
                                    "reason",
                                )
                            }
                        ),
                    },
                )

        connection.execute(
            text("""
            INSERT INTO audit_events(organization_id, actor_id, entity_type, entity_id, action, new_json)
            VALUES (:org, :actor, 'import_batches', :id, 'statement_import', CAST(:data AS jsonb))
        """),
            {
                "org": organization_id,
                "actor": actor_id,
                "id": batch,
                "data": json.dumps(
                    {
                        "files": len(files),
                        "new_movements": result["new"],
                        "reimports": [
                            {
                                "previous_file_id": f["previous_import_file_id"],
                                "generation": f["generation"],
                                "movements": f["restored"],
                            }
                            for f in result["files"]
                            if f["reimported"]
                        ],
                        "submitted_decisions": [
                            {"sha256": statement.digest, "rows": upload.decisions}
                            for upload, statement, _, _, _ in files
                            if upload.decisions
                        ],
                    }
                ),
            },
        )
        return {
            "batch_id": str(batch),
            "imported": result["new"],
            "file_ids": list(dict.fromkeys(file_ids)),
        }


@router.get("")
def statement_history(organization_id: UUID, request: Request):
    with request.app.state.database.connect() as connection:
        rows = connection.execute(
            text("""
            SELECT f.id, f.file_name, a.label AS account_label,
                f.period_start, f.period_end, b.created_at
            FROM import_files f JOIN bank_accounts a ON a.id=f.bank_account_id
            JOIN import_batches b ON b.id=f.batch_id
            WHERE f.organization_id=:org ORDER BY b.created_at DESC LIMIT 500
        """),
            {"org": organization_id},
        ).mappings()
        return [dict(row) for row in rows]
