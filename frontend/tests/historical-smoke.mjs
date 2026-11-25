import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

async function api(path, body) {
  const response = await fetch(
    "http://127.0.0.1:8000" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
const org = await api("/organizations", { name: "Histórico sintético" });
const base = "/organizations/" + org.id;
for (const [label, number, digit] of [
  ["Conta A", "12345", "6"],
  ["Conta B", "78901", "2"],
])
  await api(base + "/bank-accounts", {
    label,
    bank_code: "033",
    branch: "0001",
    account_number: number,
    account_digit: digit,
    currency: "BRL",
    active: true,
  });
for (const [name, kind, sub] of [
  ["Recebimento", "REVENUE", "PIX à Vista"],
  ["Transferência Bancária", "NEUTRAL", "Transferência Bancária"],
]) {
  const category = await api(base + "/categories", { name, kind });
  await api(base + "/subcategories", { name: sub, category_id: category.id });
}
await api(base + "/cost-centers", { name: "Centro sintético" });
const accounts = await api(base + "/bank-accounts");
const python = `import io,base64
from datetime import datetime
from openpyxl import Workbook
w=Workbook(); w.active.title='Resumo'; s=w.create_sheet('LANÇAMENTOS')
s.append(['Unidade','Data','Lançamento','Dcto.','Crédito (R$)','Débito (R$)','Classificação','Sub Classificação','L/F/D','MêsAno','Centro de Custos'])
for i in range(2): s.append(['Conta A',datetime(2025,1,2),'PIX SINTETICO','01',100,None,'Recebimento','PIX à Vista','L','202501','Centro sintético'])
s.append(['Conta B',datetime(2025,1,3),'TRANSFERENCIA SINTETICA',None,None,-50,'Transferência Bancária','Transferência Bancária','L','202501',None])
b=io.BytesIO(); w.save(b); print(base64.b64encode(b.getvalue()).decode())`;
const content = execFileSync(
  "docker",
  ["compose", "exec", "-T", "api", "python", "-c", python],
  { encoding: "utf-8", cwd: ".." },
).trim();
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate(
    (id) => localStorage.setItem("autovisao.organization", id),
    org.id,
  );
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transações", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Histórico", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar Base Histórica", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Importar Base Histórica",
    exact: true,
  });
  await modal
    .getByLabel("Planilha histórica XLSX", { exact: true })
    .setInputFiles({
      name: "historico-sintetico.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(content, "base64"),
    });
  await modal
    .getByRole("button", {
      name: "Importar 3 Movimentos Identificados",
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: "import-layout-historical-preview.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", {
      name: "Importar 3 Movimentos Identificados",
      exact: true,
    })
    .click();
  await modal
    .getByRole("status")
    .filter({ hasText: "Base histórica gravada e identificada" })
    .waitFor();
  assert.equal((await api(base + "/transactions?state=identified")).total, 3);
  assert.equal((await api(base + "/transactions?state=pending")).total, 0);
  assert.deepEqual(await api(base + "/bank-accounts"), accounts);
  await page.screenshot({
    path: "import-layout-historical-complete.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "Ver Histórico", exact: true })
    .click();
  const repeated = await api(base + "/historical-import/preview", {
    file_name: "historico-sintetico.xlsx",
    content,
  });
  assert.equal(repeated.new, 0);
  const result = await api(base + "/historical-import/commit", {
    file_name: "historico-sintetico.xlsx",
    content,
    token: repeated.token,
  });
  assert.equal(result.imported, 0);
  assert.equal((await api(base + "/transactions?state=all")).total, 3);
  // Acrescenta período novo sem comparar a conferência com o histórico acumulado.
  const appendedContent = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "api",
      "python",
      "-c",
      python
        .replaceAll("datetime(2025,1,2)", "datetime(2026,11,23)")
        .replaceAll("datetime(2025,1,3)", "datetime(2026,11,23)"),
    ],
    { encoding: "utf-8", cwd: ".." },
  ).trim();
  await page
    .getByRole("button", { name: "Importar Base Histórica", exact: true })
    .click();
  await modal.getByLabel("Tipo de carga", { exact: true }).fill("Acrescentar");
  await page
    .getByRole("option", {
      name: "Acrescentar período ao histórico",
      exact: true,
    })
    .click();
  await modal
    .getByLabel("Planilha histórica XLSX", { exact: true })
    .setInputFiles({
      name: "historico-novo-periodo.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(appendedContent, "base64"),
    });
  await modal
    .getByRole("button", {
      name: "Importar 3 Movimentos Identificados",
      exact: true,
    })
    .click();
  await modal
    .getByRole("status")
    .filter({ hasText: "Base histórica gravada e identificada" })
    .waitFor();
  assert.equal((await api(base + "/transactions?state=identified")).total, 6);
  assert.deepEqual(await api(base + "/bank-accounts"), accounts);
  await page.screenshot({
    path: "import-layout-historical-append-complete.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
