import base64
import binascii
import csv
import io
import re
from typing import Literal
from unicodedata import normalize
from uuid import UUID
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, HTTPException, Request, Response
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.bank_accounts import BankAccountInput
from app.catalog import Catalog, lock_organization, record_audit
from app.catalogs import (
    CategoryInput,
    CostCenterInput,
    PartyInput,
    SubcategoryInput,
    validate_parent,
)
from app.codes import next_catalog_code

router = APIRouter(
    prefix="/organizations/{organization_id}/table-imports", tags=["Importações"]
)
Kind = Literal["bank-accounts", "categories", "cost-centers", "parties"]
MAX_ROWS = 2000
MAX_BYTES = 5 * 1024 * 1024

# Campo, título, obrigatório, cabeçalhos alternativos.
FIELDS = {
    "bank-accounts": [
        ("label", "Nome da conta", True, ["unidade", "nome", "conta bancaria"]),
        ("bank_code", "Banco", True, ["codigo banco", "codigo do banco"]),
        ("branch", "Agência", True, ["agencia bancaria"]),
        ("account_number", "Número da conta", True, ["conta", "cc", "conta corrente"]),
        ("account_digit", "Dígito da conta", False, ["digito", "dv"]),
        ("holder_document", "CPF/CNPJ do titular", False, ["cnpj", "cpf", "documento"]),
        ("account_type", "Tipo de conta", False, []),
        ("currency", "Moeda", False, ["currency"]),
        ("active", "Ativo", False, ["situacao", "status", "cadastro ativo"]),
    ],
    "categories": [
        ("name", "Classificação", True, ["nome", "categoria"]),
        ("kind", "Natureza", True, ["tipo", "receita despesa"]),
        ("description", "Descrição", False, []),
        ("sub_name", "Subclassificação", False, ["sub classificacao", "subclasse"]),
        ("sub_description", "Descrição da subclassificação", False, []),
        ("active", "Ativo", False, ["situacao", "status"]),
    ],
    "cost-centers": [
        (
            "name",
            "Nome do centro de custos",
            True,
            ["nome", "centro de custos", "centro de custo"],
        ),
        ("parent", "Centro superior", False, ["pai", "centro pai"]),
        ("active", "Ativo", False, ["situacao", "status"]),
    ],
    "parties": [
        ("display_name", "Nome do Cliente", True, ["nome", "cliente", "fornecedor"]),
        ("type", "Tipo", True, ["cliente fornecedor", "tipo de cadastro"]),
        ("tax_id", "CPF ou CNPJ", False, ["cpf", "cnpj", "documento", "cpf cnpj"]),
        ("contact_name", "Contato", False, ["nome contato", "pessoa de contato"]),
        ("contact_email", "E-mail", False, ["email"]),
        ("contact_phone", "Telefone", False, ["celular", "fone"]),
        ("active", "Ativo", False, ["situacao", "status"]),
    ],
}
TABLES = {
    "bank-accounts": "bank_accounts",
    "categories": "categories",
    "cost-centers": "cost_centers",
    "parties": "parties",
}
MODELS = {
    "bank-accounts": BankAccountInput,
    "categories": CategoryInput,
    "cost-centers": CostCenterInput,
    "parties": PartyInput,
}


class Source(BaseModel):
    file_name: str = Field(max_length=250)
    content: str = Field(max_length=7 * 1024 * 1024)
    sheet: str | None = None
    header_row: int = Field(default=1, ge=1, le=100)


class MappedSource(Source):
    mapping: dict[str, int] = Field(max_length=30)
    constants: dict[str, str] = Field(default_factory=dict, max_length=2)


def key(value) -> str:
    value = normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def cell(value) -> str:
    return str(value).strip() if value is not None else ""


def read_source(source: Source):
    try:
        raw = base64.b64decode(source.content, validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(422, "Arquivo inválido.") from error
    if len(raw) > MAX_BYTES:
        raise HTTPException(422, "O limite por arquivo é 5 MB.")
    sheets = []
    if source.file_name.lower().endswith(".csv"):
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = raw.decode("cp1252")
        try:
            dialect = csv.Sniffer().sniff(content[:10000], delimiters=";,\t,")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(io.StringIO(content), dialect))
    elif source.file_name.lower().endswith(".xlsx"):
        try:
            with ZipFile(io.BytesIO(raw)) as archive:
                if (
                    sum(item.file_size for item in archive.infolist())
                    > 40 * 1024 * 1024
                ):
                    raise HTTPException(
                        422, "A planilha descompactada excede o limite."
                    )
            book = load_workbook(io.BytesIO(raw), read_only=True, data_only=False)
            try:
                sheets = book.sheetnames
                selected = source.sheet or sheets[0]
                if selected not in sheets:
                    raise HTTPException(422, "A aba escolhida não existe.")
                sheet = book[selected]
                if sheet.max_row and sheet.max_row > MAX_ROWS + source.header_row:
                    raise HTTPException(
                        422,
                        "A aba excede o limite de linhas. Divida o arquivo em cargas menores.",
                    )
                if sheet.max_column and sheet.max_column > 100:
                    raise HTTPException(422, "Use uma tabela com até 100 colunas.")
                rows = []
                for row in sheet.iter_rows(max_row=MAX_ROWS + source.header_row + 2):
                    if any(item.data_type == "f" for item in row):
                        raise HTTPException(
                            422, "Converta as fórmulas em valores antes de importar."
                        )
                    rows.append([cell(item.value) for item in row])
            finally:
                book.close()
        except (BadZipFile, ValueError, KeyError) as error:
            raise HTTPException(422, "Não foi possível ler o XLSX.") from error
    else:
        raise HTTPException(422, "Escolha um arquivo CSV ou XLSX.")

    if len(rows) < source.header_row:
        raise HTTPException(422, "A linha de cabeçalho não foi encontrada.")
    headers = [
        cell(value) or f"Coluna {i + 1}"
        for i, value in enumerate(rows[source.header_row - 1])
    ]
    if not headers or len(headers) > 100:
        raise HTTPException(422, "Use uma tabela com até 100 colunas.")
    data = [
        (index, [cell(value) for value in row])
        for index, row in enumerate(rows[source.header_row :], source.header_row + 1)
        if any(cell(value) for value in row)
    ]
    if not data or len(data) > MAX_ROWS:
        raise HTTPException(
            422, f"O arquivo deve conter de 1 a {MAX_ROWS} registros por carga."
        )
    return sheets, headers, data


@router.post("/{kind}/preview")
def preview(kind: Kind, payload: Source):
    sheets, headers, rows = read_source(payload)
    mapping = {}
    for field, label, _, aliases in FIELDS[kind]:
        matches = [
            i
            for i, header in enumerate(headers)
            if key(header)
            in {key(field), key(label), *(key(alias) for alias in aliases)}
        ]
        if len(matches) == 1 and matches[0] not in mapping.values():
            mapping[field] = matches[0]
    return {
        "sheets": sheets,
        "headers": headers,
        "sample": [row for _, row in rows[:5]],
        "total": len(rows),
        "fields": [
            {"name": name, "label": label, "required": required}
            for name, label, required, _ in FIELDS[kind]
        ],
        "mapping": mapping,
    }


def boolean(value):
    if not value:
        return True
    normalized = key(value)
    if normalized in {"sim", "true", "1", "ativo", "s"}:
        return True
    if normalized in {"nao", "false", "0", "inativo", "n"}:
        return False
    raise ValueError("Ativo deve ser Sim ou Não.")


def translate(value, choices, label):
    normalized = key(value)
    for translated, aliases in choices.items():
        if normalized in {key(translated), *(key(alias) for alias in aliases)}:
            return translated
    raise ValueError(f"Valor inválido em {label}.")


def find_named(connection, table, organization_id, name, parent=None):
    if table == "subcategories":
        rows = connection.execute(
            text("SELECT * FROM subcategories WHERE category_id = :parent"),
            {"parent": parent},
        ).mappings()
        field = "name"
    else:
        rows = connection.execute(
            text(f"SELECT * FROM {table} WHERE organization_id = :org"),
            {"org": organization_id},
        ).mappings()
        field = {"parties": "display_name", "bank_accounts": "label"}.get(table, "name")
    found = [dict(row) for row in rows if key(row[field] or "") == key(name)]
    if len(found) > 1:
        raise ValueError(
            "Há nomes repetidos no sistema. Revise os cadastros antes de importar."
        )
    return found[0] if found else None


def insert_record(connection, organization_id, table, model, values, parent=None):
    data = model.model_validate(values).model_dump()
    name_field = {"parties": "display_name", "bank_accounts": "label"}.get(
        table, "name"
    )
    existing = find_named(connection, table, organization_id, data[name_field], parent)
    if table == "parties" and data.get("tax_id"):
        documents = connection.execute(
            text("SELECT * FROM parties WHERE organization_id = :org"),
            {"org": organization_id},
        ).mappings()
        same_document = [
            dict(row)
            for row in documents
            if re.sub(r"\D", "", row["tax_id"] or "") == data["tax_id"]
        ]
        if len(same_document) > 1:
            raise ValueError("Documento duplicado no sistema.")
        if same_document:
            if existing and existing["id"] != same_document[0]["id"]:
                raise ValueError(
                    "Nome e documento correspondem a cadastros diferentes."
                )
            existing = same_document[0]
    if table == "bank_accounts" and not existing:
        candidates = connection.execute(
            text("SELECT * FROM bank_accounts WHERE organization_id = :org"),
            {"org": organization_id},
        ).mappings()
        if any(
            row["bank_code"] == data["bank_code"]
            and row["branch"] == data["branch"]
            and row["account_number"] == data["account_number"]
            for row in candidates
        ):
            raise ValueError(
                "Esta agência e conta já estão cadastradas com outro nome."
            )
    if existing:
        compared = [
            field
            for field, value in data.items()
            if value is not None and field != "code"
        ]
        if table == "parties" and existing.get("tax_id"):
            existing["tax_id"] = re.sub(r"\D", "", existing["tax_id"])
        if any(existing[field] != data[field] for field in compared):
            raise ValueError(
                "Já existe cadastro com esse nome/documento e dados diferentes."
            )
        return existing, False

    if table in {"bank_accounts", "categories", "subcategories", "cost_centers"}:
        data["code"] = next_catalog_code(connection, table, parent or organization_id)
    if table != "subcategories":
        data["organization_id"] = organization_id
    columns = ", ".join(data)
    placeholders = ", ".join(f":{name}" for name in data)
    current = dict(
        connection.execute(
            text(
                f"INSERT INTO {table} ({columns}) VALUES ({placeholders}) RETURNING *"
            ),
            data,
        )
        .mappings()
        .one()
    )
    catalog = Catalog(
        "",
        table,
        "",
        model,
        model,
        private_fields=frozenset(
            {
                "holder_document",
                "account_number",
                "account_digit",
                "holder_name",
                "tax_id",
                "contact_name",
                "contact_email",
                "contact_phone",
                "display_name",
            }
        ),
    )
    record_audit(connection, catalog, organization_id, "import", current)
    return current, True


def row_values(kind, row, mapping, constants):
    values = {
        field: row[index] if index < len(row) else ""
        for field, index in mapping.items()
    }
    values.update(constants)
    for field, _, required, _ in FIELDS[kind]:
        if required and not values.get(field):
            raise ValueError("Preencha o campo obrigatório: " + field)
    values["active"] = boolean(values.get("active", ""))
    values = {field: value for field, value in values.items() if value != ""}
    if kind == "categories":
        values["kind"] = translate(
            values["kind"],
            {
                "REVENUE": ["Receita"],
                "EXPENSE": ["Despesa"],
                "NEUTRAL": ["Neutra"],
            },
            "Natureza",
        )
    if kind == "parties":
        values["type"] = translate(
            values["type"],
            {
                "CUSTOMER": ["Cliente"],
                "SUPPLIER": ["Fornecedor"],
                "BOTH": ["Ambos", "Cliente e fornecedor"],
            },
            "Tipo",
        )
        if values.get("tax_id"):
            values["tax_id"] = re.sub(r"\D", "", values["tax_id"])
    if kind == "bank-accounts":
        if not values["bank_code"].isdigit() or len(values["bank_code"]) > 3:
            raise ValueError("Banco deve conter o código numérico de três dígitos.")
        values["bank_code"] = values["bank_code"].zfill(3)
        if "-" in values["account_number"] and not values.get("account_digit"):
            values["account_number"], values["account_digit"] = values[
                "account_number"
            ].rsplit("-", 1)
        values.setdefault("currency", "BRL")
        values["currency"] = values["currency"].upper()
        if values.get("account_type"):
            values["account_type"] = translate(
                values["account_type"],
                {
                    "CHECKING": ["Conta corrente"],
                    "SAVINGS": ["Poupança"],
                    "PAYMENT": ["Conta de pagamento"],
                },
                "Tipo de conta",
            )
    return values


def process(connection, organization_id, kind, payload):
    _, headers, rows = read_source(payload)
    fields = {field for field, _, _, _ in FIELDS[kind]}
    if any(
        field not in fields or index < 0 or index >= len(headers)
        for field, index in payload.mapping.items()
    ):
        raise HTTPException(422, "Mapeamento inválido.")
    if len(set(payload.mapping.values())) != len(payload.mapping):
        raise HTTPException(422, "Associe cada coluna a apenas um campo.")
    allowed_constants = {"active", "type"} if kind == "parties" else {"active"}
    if set(payload.constants) - allowed_constants or set(payload.constants) & set(
        payload.mapping
    ):
        raise HTTPException(422, "Escolha coluna ou valor fixo para cada campo.")
    result = []
    for number, row in rows:
        try:
            with connection.begin_nested():
                values = row_values(kind, row, payload.mapping, payload.constants)
                sub_name = values.pop("sub_name", None)
                sub_description = values.pop("sub_description", None)
                parent_name = values.pop("parent", None)
                if kind == "cost-centers" and parent_name:
                    parent = find_named(
                        connection, "cost_centers", organization_id, parent_name
                    )
                    if not parent:
                        raise ValueError(
                            "Cadastre o centro superior antes dos subordinados."
                        )
                    values["parent_id"] = parent["id"]
                    validate_parent(connection, organization_id, values, None)
                current, created = insert_record(
                    connection, organization_id, TABLES[kind], MODELS[kind], values
                )
                sub_created = False
                if kind == "categories" and sub_name:
                    _, sub_created = insert_record(
                        connection,
                        organization_id,
                        "subcategories",
                        SubcategoryInput,
                        {
                            "name": sub_name,
                            "description": sub_description,
                            "category_id": current["id"],
                            "active": values["active"],
                        },
                        current["id"],
                    )
                result.append(
                    {
                        "row": number,
                        "status": "new" if created or sub_created else "duplicate",
                        "message": "Novo cadastro"
                        if created or sub_created
                        else "Já cadastrado",
                    }
                )
        except ValidationError as error:
            messages = [
                str(item["loc"][0]) + ": " + item["msg"] for item in error.errors()
            ]
            result.append(
                {"row": number, "status": "error", "message": "; ".join(messages)}
            )
        except (ValueError, HTTPException) as error:
            message = (
                str(error.detail) if isinstance(error, HTTPException) else str(error)
            )
            result.append({"row": number, "status": "error", "message": message})
        except IntegrityError:
            result.append(
                {
                    "row": number,
                    "status": "error",
                    "message": "O registro conflita com os dados existentes.",
                }
            )
    return {
        "rows": result,
        "new": sum(row["status"] == "new" for row in result),
        "duplicates": sum(row["status"] == "duplicate" for row in result),
        "errors": sum(row["status"] == "error" for row in result),
    }


@router.post("/{kind}/validate")
def validate(
    organization_id: UUID, kind: Kind, payload: MappedSource, request: Request
):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        transaction = connection.begin_nested()
        try:
            return process(connection, organization_id, kind, payload)
        finally:
            transaction.rollback()


@router.post("/{kind}/commit")
def commit(organization_id: UUID, kind: Kind, payload: MappedSource, request: Request):
    with request.app.state.database.begin() as connection:
        lock_organization(connection, organization_id)
        result = process(connection, organization_id, kind, payload)
        if result["errors"]:
            raise HTTPException(
                422, "Há erros na carga. Valide o arquivo novamente antes de gravar."
            )
        return result


@router.get("/{kind}/template")
def template(kind: Kind, format: Literal["csv", "xlsx"] = "xlsx"):
    headers = [label for _, label, _, _ in FIELDS[kind]]
    if format == "csv":
        output = io.StringIO()
        csv.writer(output, delimiter=";").writerow(headers)
        data = output.getvalue().encode("utf-8-sig")
        media = "text/csv"
    else:
        book = Workbook()
        sheet = book.active
        sheet.title = "Cadastros"
        sheet.append(headers)
        sheet.freeze_panes = "A2"
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = 28
        for row in sheet.iter_rows(
            min_row=2, max_row=MAX_ROWS + 1, max_col=len(headers)
        ):
            for item in row:
                item.number_format = "@"
        output = io.BytesIO()
        book.save(output)
        data = output.getvalue()
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(
        data,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="modelo-{kind}.{format}"'
        },
    )
