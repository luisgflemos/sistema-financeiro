"""Leitura do layout XLSX/CSV do Santander validado com o extrato fornecido."""

import base64
import binascii
import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from zipfile import ZipFile

from openpyxl import load_workbook

MAX_FILE_BYTES = 5 * 1024 * 1024


@dataclass
class Movement:
    row: int
    posted_on: str
    description: str
    document: str
    signed_amount: Decimal
    balance: Decimal | None

    def fingerprint(self):
        value = [
            self.posted_on,
            " ".join(self.description.upper().split()),
            self.document.strip(),
            str(self.signed_amount),
        ]
        return sha256("\x1f".join(value).encode()).hexdigest()

    def public(self):
        balance = f"{self.balance:.2f}" if self.balance is not None else None
        return {
            "row": self.row,
            "posted_on": self.posted_on,
            "description": self.description,
            "document": self.document,
            "direction": "CREDIT" if self.signed_amount > 0 else "DEBIT",
            "amount": f"{abs(self.signed_amount):.2f}",
            "balance": balance,
            "fingerprint": self.fingerprint(),
            "signature": sha256((self.fingerprint() + "\x1f" + balance).encode()).hexdigest()
            if balance is not None
            else None,
        }


@dataclass
class Statement:
    raw: bytes
    digest: str
    branch: str
    account: str
    movements: list[Movement]

    def summary(self):
        return {
            "branch": self.branch,
            "account": self.account,
            "period_start": min(row.posted_on for row in self.movements),
            "period_end": max(row.posted_on for row in self.movements),
            "credits": f"{sum((row.signed_amount for row in self.movements if row.signed_amount > 0), Decimal(0)):.2f}",
            "debits": f"{-sum((row.signed_amount for row in self.movements if row.signed_amount < 0), Decimal(0)):.2f}",
            "count": len(self.movements),
        }


def digits(value):
    return re.sub(r"\D", "", str(value or ""))


def money(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("Valor ou saldo ausente.")
    source = str(value).strip().replace("R$", "").replace(" ", "")
    if "," in source:
        source = source.replace(".", "").replace(",", ".")
    try:
        result = Decimal(source)
    except InvalidOperation as error:
        raise ValueError("Valor monetário inválido.") from error
    if not result.is_finite() or abs(result) >= Decimal("10000000000000000"):
        raise ValueError("Valor monetário fora do limite.")
    if result != result.quantize(Decimal("0.01")):
        raise ValueError("O valor contém frações de centavo.")
    return result.quantize(Decimal("0.01"))


def parse_statement(file_name, encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Arquivo inválido.") from error
    if not raw or len(raw) > MAX_FILE_BYTES:
        raise ValueError("Cada extrato deve ter até 5 MB.")
    suffix = file_name.lower().rsplit(".", 1)[-1]
    try:
        if suffix == "xlsx":
            with ZipFile(io.BytesIO(raw)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 40 * 1024 * 1024:
                    raise ValueError("A planilha descompactada excede o limite.")
            book = load_workbook(io.BytesIO(raw), read_only=True, data_only=False)
            try:
                if len(book.worksheets) != 1:
                    raise ValueError("Use um extrato Santander com uma única aba.")
                sheet = book.active
                if sheet.max_row > 10003 or sheet.max_column > 20:
                    raise ValueError("O extrato excede 10.000 movimentos ou 20 colunas.")
                rows = []
                for row in sheet.iter_rows():
                    if any(cell.data_type == "f" for cell in row):
                        raise ValueError("O extrato precisa conter valores, sem fórmulas.")
                    rows.append([cell.value for cell in row])
            finally:
                book.close()
        elif suffix == "csv":
            try:
                content = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                content = raw.decode("cp1252")
            sample = "".join(content.splitlines(keepends=True)[2:22])
            dialect = csv.Sniffer().sniff(sample[:10000], delimiters=";,\t")
            rows = list(csv.reader(io.StringIO(content), dialect))
            if len(rows) > 10003:
                raise ValueError("O extrato excede 10.000 movimentos.")
        else:
            raise ValueError("Envie XLSX ou CSV no layout Santander validado.")
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("Não foi possível ler o extrato.") from error

    if len(rows) < 4 or len(rows[0]) < 4 or len(rows[2]) < 4:
        raise ValueError("O arquivo não corresponde ao layout Santander esperado.")
    first, header = rows[0], rows[2]
    if (
        str(first[0]).strip().upper() != "AGENCIA"
        or str(first[2]).strip().upper() != "CONTA"
        or str(header[0]).strip().lower() != "data"
        or str(header[2]).strip().lower() != "documento"
        or str(header[3]).strip().lower() != "valor (r$)"
        or (
            len(header) > 4
            and header[4] not in (None, "")
            and str(header[4]).strip().lower() != "saldo (r$)"
        )
    ):
        raise ValueError("Layout não reconhecido. Use o extrato exportado do Santander.")
    branch, account = digits(first[1]), digits(first[3])
    if not branch or not account:
        raise ValueError("O cabeçalho não informa agência e conta.")
    movements = []
    for number, values in enumerate(rows[3:], 4):
        if not any(value not in (None, "") for value in values):
            continue
        try:
            date_value = values[0]
            posted = (
                date_value.date()
                if isinstance(date_value, datetime)
                else datetime.strptime(str(date_value).strip(), "%d/%m/%Y").date()
            )
            amount = money(values[3])
            balance = (
                money(values[4]) if len(values) > 4 and values[4] not in (None, "", " ") else None
            )
            description = str(values[1] or "")
            if not amount or not description.strip():
                raise ValueError("Movimento sem valor ou histórico.")
            movements.append(
                Movement(
                    number,
                    posted.isoformat(),
                    description,
                    str(values[2] or ""),
                    amount,
                    balance,
                )
            )
        except (ValueError, IndexError, InvalidOperation) as error:
            raise ValueError(f"Linha {number}: {error}") from error
    if not movements:
        raise ValueError("O extrato não contém movimentos.")
    descending = all(
        current.posted_on >= following.posted_on
        for current, following in zip(movements, movements[1:])
    )
    if not descending:
        raise ValueError("A ordem das datas difere do layout validado. Revise o arquivo.")
    expected = None
    previous = None
    for current in reversed(movements):
        if expected is not None:
            expected += current.signed_amount
        if current.balance is not None:
            if expected is not None and current.balance != expected:
                raise ValueError(
                    f"Os saldos não conferem entre as linhas {current.row} e {previous.row}."
                )
            expected = current.balance
            previous = current
    return Statement(raw, sha256(raw).hexdigest(), branch, account, movements)
