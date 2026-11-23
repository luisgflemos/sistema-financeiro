from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.catalog import lock_organization
from app.codes import next_catalog_code

RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
MaskedAccount = Annotated[str, StringConstraints(pattern=r"^\*{2,}[0-9]{0,4}$")]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]

router = APIRouter(
    prefix="/organizations/{organization_id}/bank-accounts", tags=["Contas bancárias"]
)


class BankAccountInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: RequiredText | None = None
    label: RequiredText | None = None
    holder_document: Annotated[str, StringConstraints(pattern=r"^(?:[0-9]{11}|[0-9]{14})$")] | None = None
    account_number: Annotated[str, StringConstraints(pattern=r"^[0-9]{1,20}$")] | None = None
    account_digit: Annotated[str, StringConstraints(pattern=r"^[0-9Xx]{1,2}$")] | None = None
    account_type: str | None = None
    bank_code: RequiredText
    branch: RequiredText
    account_number_masked: MaskedAccount
    holder_name: RequiredText
    currency: Currency = "BRL"
    active: bool = True


class BankAccount(BankAccountInput):
    code: RequiredText
    bank_code: str | None
    branch: str | None
    account_number_masked: str | None
    holder_name: str | None
    label: str | None = None
    id: UUID
    organization_id: UUID


def require_account(connection, organization_id: UUID, account_id: UUID, *, lock=False):
    query = "SELECT * FROM bank_accounts WHERE organization_id = :org AND id = :id"
    if lock:
        query += " FOR UPDATE"
    account = (
        connection.execute(text(query), {"org": organization_id, "id": account_id})
        .mappings()
        .one_or_none()
    )
    if account is None:
        raise HTTPException(404, "Conta bancária não encontrada.")
    return BankAccount.model_validate(account)


def audit(connection, action: str, current: BankAccount, previous: BankAccount | None = None):
    excluded = {
        "holder_name", "branch", "account_number_masked",
        "holder_document", "account_number", "account_digit",
    }
    connection.execute(
        text(
            """
            INSERT INTO audit_events (
                organization_id, entity_type, entity_id, action, old_json, new_json
            )
            VALUES (
                :org, 'bank_accounts', :id, :action,
                CAST(:previous AS jsonb), CAST(:current AS jsonb)
            )
            """
        ),
        {
            "org": current.organization_id,
            "id": current.id,
            "action": action,
            "previous": previous.model_dump_json(exclude=excluded) if previous else None,
            "current": current.model_dump_json(exclude=excluded),
        },
    )


def account_conflict(error: IntegrityError):
    if error.orig.sqlstate == "23505":
        return HTTPException(409, "Já existe uma conta com esse código na organização.")
    if error.orig.sqlstate == "23503":
        return HTTPException(409, "A alteração conflita com movimentos vinculados à conta.")
    raise error


@router.get("")
def list_accounts(
    organization_id: UUID, request: Request, active: bool | None = None
) -> list[BankAccount]:
    with request.app.state.database.connect() as connection:
        rows = connection.execute(
            text(
                """
                SELECT * FROM bank_accounts
                WHERE organization_id = :org
                  AND (CAST(:active AS boolean) IS NULL OR active = :active)
                ORDER BY code
                """
            ),
            {"org": organization_id, "active": active},
        ).mappings()
        return [BankAccount.model_validate(row) for row in rows]


@router.get("/{account_id}")
def get_account(organization_id: UUID, account_id: UUID, request: Request) -> BankAccount:
    with request.app.state.database.connect() as connection:
        return require_account(connection, organization_id, account_id)


@router.post("", status_code=201)
def create_account(
    organization_id: UUID, payload: BankAccountInput, request: Request
) -> BankAccount:
    try:
        with request.app.state.database.begin() as connection:
            lock_organization(connection, organization_id)
            code = payload.code or next_catalog_code(connection, "bank_accounts", organization_id)
            row = (
                connection.execute(
                    text(
                        """
                        INSERT INTO bank_accounts (
                            organization_id, code, label, bank_code, branch, account_number_masked,
                            holder_name, currency, active, holder_document, account_number,
                            account_digit, account_type
                        )
                        VALUES (
                            :org, :code, :label, :bank_code, :branch, :account_number_masked,
                            :holder_name, :currency, :active, :holder_document, :account_number,
                            :account_digit, :account_type
                        )
                        RETURNING *
                        """
                    ),
                    {"org": organization_id, **payload.model_dump(), "code": code},
                )
                .mappings()
                .one()
            )
            account = BankAccount.model_validate(row)
            audit(connection, "create", account)
        return account
    except IntegrityError as error:
        raise account_conflict(error) from error


@router.put("/{account_id}")
def update_account(
    organization_id: UUID,
    account_id: UUID,
    payload: BankAccountInput,
    request: Request,
) -> BankAccount:
    try:
        with request.app.state.database.begin() as connection:
            lock_organization(connection, organization_id)
            previous = require_account(connection, organization_id, account_id, lock=True)
            values = payload.model_dump()
            values["code"] = payload.code or previous.code
            values["label"] = payload.label or previous.label
            current = BankAccount(id=account_id, organization_id=organization_id, **values)
            if current != previous:
                connection.execute(
                    text(
                        """
                        UPDATE bank_accounts SET
                            code = :code, label = :label, bank_code = :bank_code, branch = :branch,
                            account_number_masked = :account_number_masked,
                            holder_name = :holder_name, currency = :currency, active = :active,
                            holder_document = :holder_document, account_number = :account_number,
                            account_digit = :account_digit, account_type = :account_type
                        WHERE id = :id AND organization_id = :org
                        """
                    ),
                    {"org": organization_id, "id": account_id, **values},
                )
                audit(connection, "update", current, previous)
        return current
    except IntegrityError as error:
        raise account_conflict(error) from error


@router.delete("/{account_id}", status_code=204)
def deactivate_account(organization_id: UUID, account_id: UUID, request: Request) -> Response:
    with request.app.state.database.begin() as connection:
        previous = require_account(connection, organization_id, account_id, lock=True)
        if previous.active:
            connection.execute(
                text(
                    "UPDATE bank_accounts SET active = false "
                    "WHERE id = :id AND organization_id = :org"
                ),
                {"id": account_id, "org": organization_id},
            )
            audit(connection, "deactivate", previous.model_copy(update={"active": False}), previous)
    return Response(status_code=204)
