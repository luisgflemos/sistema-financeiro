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
const org = await api("/organizations", { name: "Vínculos sintéticos" });
const base = "/organizations/" + org.id;
await api(base + "/bank-accounts", {
  label: "Conta A",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  currency: "BRL",
  active: true,
});
const category = await api(base + "/categories", {
  name: "Recebimento",
  kind: "REVENUE",
});
await api(base + "/subcategories", {
  name: "PIX Faturado",
  category_id: category.id,
});
await api(base + "/cost-centers", { name: "Centro sintético" });
await api(base + "/parties", {
  display_name: "Cliente de teste",
  type: "CUSTOMER",
});
const python = `import io,base64
from datetime import datetime
from openpyxl import Workbook
w=Workbook(); s=w.active;s.title='LANÇAMENTOS'
s.append(['Unidade','Data','Lançamento','Crédito (R$)','Débito (R$)','Classificação','Sub Classificação','Centro de Custos'])
for i in range(2):s.append(['Conta A',datetime(2026,1,2),'PIX RECEBIDO PAGADOR TESTE',50,None,'Recebimento','PIX Faturado','Centro sintético'])
s.append(['Conta A',datetime(2026,1,3),'PIX RECEBIDO PAGADOR TESTE',50,None,'Recebimento','PIX Faturado','Centro sintético'])
b=io.BytesIO();w.save(b);print(base64.b64encode(b.getvalue()).decode())`;
const content = execFileSync(
  "docker",
  ["compose", "exec", "-T", "api", "python", "-c", python],
  { encoding: "utf-8", cwd: ".." },
).trim();
const upload = { file_name: "historico.xlsx", content };
const checked = await api(base + "/historical-import/preview", upload);
await api(base + "/historical-import/commit", {
  ...upload,
  token: checked.token,
});
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
  assert.equal(
    await page
      .getByRole("button", { name: "Excluir selecionados", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Vincular Clientes", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Vincular Clientes ao Histórico",
    exact: true,
  });
  await modal.getByLabel("Movimentos até", { exact: true }).fill("2026-01-02");
  await modal
    .getByLabel("Arquivo de vínculos CSV", { exact: true })
    .setInputFiles({
      name: "vinculos.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Pagador;Cliente;Quantidade;Total\nPAGADOR TESTE;Cliente de teste;2;100.00\n",
      ),
    });
  await modal
    .getByRole("button", { name: "Confirmar 2 Vínculos", exact: true })
    .waitFor();
  assert.ok((await modal.innerText()).includes("Cliente de teste"));
  await page.screenshot({
    path: "import-layout-payer-links-preview.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "Confirmar 2 Vínculos", exact: true })
    .click();
  await modal
    .getByRole("status")
    .filter({ hasText: "2 vínculos gravados. 2 movimentos conferidos." })
    .waitFor();
  const records = (await api(base + "/transactions?state=identified")).rows;
  assert.equal(
    records.filter((row) => row.party_name === "Cliente de teste").length,
    2,
  );
  assert.equal(
    records.find((row) => row.posted_on === "2026-01-03").party_id,
    null,
  );
  await page.screenshot({
    path: "import-layout-payer-links-complete.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
