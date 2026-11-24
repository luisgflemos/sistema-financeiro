"""Histórico identificado: a ocorrência é a linha, nunca a semelhança financeira."""

import base64
import binascii
import io
import json
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 100000
REQUIRED = (
    "unidade",
    "data",
    "lancamento",
    "credito (r$)",
    "debito (r$)",
    "classificacao",
    "sub classificacao",
    "centro de custos",
)


def normalize(value):
    return " ".join(
        "".join(
            c
            for c in unicodedata.normalize("NFD", str(value or "").strip().casefold())
            if unicodedata.category(c) != "Mn"
        ).split()
    )


def label(value):
    return "" if value is None else str(value).strip()


def money(value):
    if value is None or value == "":
        return Decimal(0)
    source = str(value).replace("R$", "").replace(" ", "")
    if "," in source:
        source = source.replace(".", "").replace(",", ".")
    try:
        result = Decimal(source)
    except InvalidOperation as error:
        raise ValueError("Valor monetário inválido.") from error
    if not result.is_finite() or abs(result) >= Decimal("10000000000000000"):
        raise ValueError("Valor monetário fora do limite.")
    rounded = result.quantize(Decimal(".01"))
    if abs(result - rounded) > Decimal(".0000001"):
        raise ValueError("Valor com frações de centavo.")
    return rounded


def parse_historical(file_name, content):
    if not file_name.lower().endswith(".xlsx"):
        raise ValueError("Use uma planilha XLSX com a aba LANÇAMENTOS.")
    try:
        raw = base64.b64decode(content, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Arquivo inválido.") from error
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("A base histórica deve ter até 20 MB.")
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 400 * 1024 * 1024:
                raise ValueError("A planilha descompactada excede 400 MB.")
            ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            sheets = ElementTree.fromstring(archive.read("xl/workbook.xml")).find("m:sheets", ns)
            matches = [s for s in sheets if normalize(s.attrib["name"]) == "lancamentos"]
            if len(matches) != 1:
                raise ValueError("A planilha precisa de uma aba única chamada LANÇAMENTOS.")
            sheet_name = matches[0].attrib["name"]
        book = load_workbook(io.BytesIO(raw), read_only=True, data_only=False)
        try:
            sheet = book[sheet_name]
            # Ignora dimensões infladas por formatação. Limita a leitura efetiva.
            header = next(sheet.iter_rows(min_row=1, max_row=1, max_col=30, values_only=True))
            columns = {normalize(value): i for i, value in enumerate(header) if value is not None}
            if any(name not in columns for name in REQUIRED):
                raise ValueError(
                    "Cabeçalho incompatível: informe Unidade, Data, Lançamento, Crédito (R$), Débito (R$), Classificação, Sub Classificação e Centro de Custos."
                )
            if len(columns) != len([v for v in header if v is not None]):
                raise ValueError("Há títulos de coluna repetidos.")
            rows = []
            last_nonempty = 1
            # Linhas A:K sem conteúdo são apenas formatação no arquivo fornecido.
            # O limite é também verificado no XML para não truncar dados silenciosamente.
            import posixpath

            with ZipFile(io.BytesIO(raw)) as archive:
                rid = matches[0].attrib[
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
                ]
                relations = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
                target = next(r.attrib["Target"] for r in relations if r.attrib["Id"] == rid)
                xml_path = (
                    target.lstrip("/")
                    if target.startswith("/")
                    else posixpath.normpath("xl/" + target)
                )
                if archive.getinfo(xml_path).file_size > 100 * 1024 * 1024:
                    raise ValueError("A aba LANÇAMENTOS excede o limite de leitura.")
                tag = "{" + ns["m"] + "}"
                source_columns = {get_column_letter(columns[name] + 1) for name in REQUIRED}
                for _, element in ElementTree.iterparse(archive.open(xml_path), events=["end"]):
                    if element.tag == tag + "row":
                        if any(
                            c.attrib.get("r", "").rstrip("0123456789") in source_columns
                            and any(
                                ch.tag in {tag + "v", tag + "is", tag + "f"}
                                and (ch.text or list(ch))
                                for ch in c
                            )
                            for c in element
                        ):
                            last_nonempty = int(element.attrib["r"])
                        element.clear()
            if last_nonempty > MAX_ROWS + 1:
                raise ValueError("A base histórica excede 100.000 linhas.")
            for number, values in enumerate(
                sheet.iter_rows(
                    min_row=2, max_row=last_nonempty, max_col=len(header), values_only=True
                ),
                2,
            ):
                if all(values[columns[name]] in (None, "") for name in REQUIRED):
                    continue

                def cell(name):
                    return values[columns[name]] if name in columns else None

                try:
                    if any(
                        isinstance(cell(name), str)
                        and cell(name).startswith(("=", "#REF!", "#N/A", "#VALUE!"))
                        for name in REQUIRED
                    ):
                        raise ValueError(
                            "Os campos de origem precisam conter valores, não fórmulas ou erros."
                        )
                    day = cell("data")
                    if isinstance(day, datetime):
                        day = day.date()
                    if not isinstance(day, date):
                        raise ValueError("Data inválida.")
                    credit, debit = money(cell("credito (r$)")), money(cell("debito (r$)"))
                    if credit < 0 or debit > 0 or bool(credit) == bool(debit):
                        raise ValueError(
                            "Informe somente um crédito positivo ou um débito negativo por movimento."
                        )
                    account, description, category, subcategory = [
                        label(cell(name))
                        for name in ("unidade", "lancamento", "classificacao", "sub classificacao")
                    ]
                    if not all((account, description, category, subcategory)):
                        raise ValueError(
                            "Conta, descrição, classificação e subclassificação são obrigatórias."
                        )
                    document = cell("dcto.")
                    if isinstance(document, float) and document.is_integer():
                        document = int(document)
                    amount = credit or debit
                    fingerprint = sha256(
                        "\x1f".join(
                            [
                                day.isoformat(),
                                " ".join(description.upper().split()),
                                label(document),
                                str(amount),
                            ]
                        ).encode()
                    ).hexdigest()
                    rows.append(
                        {
                            "row": number,
                            "account": account,
                            "posted_on": day.isoformat(),
                            "description": description,
                            "document": label(document),
                            "direction": "CREDIT" if credit else "DEBIT",
                            "amount": f"{abs(amount):.2f}",
                            "category": category,
                            "subcategory": subcategory,
                            "cost_center": label(cell("centro de custos")),
                            "lfd": label(cell("l/f/d")),
                            "fingerprint": fingerprint,
                            "source": {
                                str(key): value.isoformat()
                                if isinstance(value, (date, datetime))
                                else str(value)
                                if isinstance(value, Decimal)
                                else value
                                for key, value in zip(header, values)
                                if key is not None
                            },
                        }
                    )
                except (ValueError, InvalidOperation) as error:
                    raise ValueError(f"Linha {number}: {error}") from error
            if not rows:
                raise ValueError("A aba LANÇAMENTOS não contém movimentos.")
            return raw, sheet_name, rows
        finally:
            book.close()
    except (BadZipFile, KeyError, ElementTree.ParseError, StopIteration) as error:
        raise ValueError("Planilha XLSX inválida ou incompleta.") from error


def financial_digest(rows):
    # Mantém multiplicidade e posição. Não inclui classificações, que não podem
    # criar uma segunda cópia financeira quando a mesma base for reenviada.
    return sha256(
        json.dumps(
            [
                [
                    r[key]
                    for key in (
                        "row",
                        "posted_on",
                        "description",
                        "document",
                        "direction",
                        "amount",
                    )
                ]
                for r in rows
            ],
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
