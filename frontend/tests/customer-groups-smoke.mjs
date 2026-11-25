import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

async function api(path, body, method = "POST") {
  const r = await fetch(
    "http://127.0.0.1:8000" + path,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  assert.ok(r.ok, await r.clone().text());
  return r.json();
}
const org = await api("/organizations", { name: "Grupos sintéticos" });
const base = "/organizations/" + org.id;
const clients = [];
for (const name of [
  "Cliente Premium",
  "Cliente Loja Um",
  "Cliente Loja Dois",
]) {
  clients.push(
    await api(base + "/parties", { display_name: name, type: "CUSTOMER" }),
  );
}
await api(base + "/bank-accounts", {
  label: "Conta A",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  currency: "BRL",
  active: true,
});
const cat = await api(base + "/categories", {
  name: "Recebimento",
  kind: "REVENUE",
});
await api(base + "/subcategories", {
  name: "PIX Faturado",
  category_id: cat.id,
});
await api(base + "/cost-centers", { name: "Centro sintético" });
const py = `import io,base64
from datetime import datetime
from openpyxl import Workbook
w=Workbook();s=w.active;s.title='LANÇAMENTOS'
s.append(['Unidade','Data','Lançamento','Crédito (R$)','Débito (R$)','Classificação','Sub Classificação','Centro de Custos'])
for desc in ['PIX RECEBIDO PAGADOR COMUM','PIX RECEBIDO PAGADOR PREMIUM']:s.append(['Conta A',datetime(2026,1,2),desc,50,None,'Recebimento','PIX Faturado','Centro sintético'])
b=io.BytesIO();w.save(b);print(base64.b64encode(b.getvalue()).decode())`;
const content = execFileSync(
  "docker",
  ["compose", "exec", "-T", "api", "python", "-c", py],
  { encoding: "utf-8", cwd: ".." },
).trim();
const upload = { file_name: "histórico-sintético.xlsx", content };
const pre = await api(base + "/historical-import/preview", upload);
await api(base + "/historical-import/commit", { ...upload, token: pre.token });
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
    .getByRole("button", { name: "Grupos de Clientes", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo Grupo", exact: true }).click();
  const modal = page.getByRole("dialog", {
    name: "Novo Grupo de Clientes",
    exact: true,
  });
  await modal.getByLabel("Nome do Grupo", { exact: true }).fill("Grupo Teste");
  await modal
    .getByLabel("Pesquisar clientes para o grupo", { exact: true })
    .fill("Premium");
  await modal
    .getByRole("checkbox", { name: "Cliente Premium", exact: true })
    .check();
  await modal
    .getByLabel("Pesquisar clientes para o grupo", { exact: true })
    .fill("");
  await modal
    .getByRole("checkbox", { name: "Cliente Loja Um", exact: true })
    .check();
  await modal
    .getByRole("checkbox", { name: "Cliente Loja Dois", exact: true })
    .check();
  await page.screenshot({
    path: "import-layout-customer-group-new.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "Salvar Grupo", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  const groups = await api(base + "/customer-groups");
  assert.equal(groups[0].member_ids.length, 3);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Clientes e Fornecedores", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar Cliente Premium", exact: true })
    .click();
  const clientModal = page.getByRole("dialog");
  assert.equal(
    await clientModal
      .getByLabel("Grupo de Clientes", { exact: true })
      .inputValue(),
    "Grupo Teste",
  );
  assert.ok(
    (await clientModal
      .getByLabel("Grupo de Clientes", { exact: true })
      .getAttribute("readonly")) !== null,
  );
  await clientModal
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transações", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Histórico", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Identificar movimento.*PAGADOR COMUM/ })
    .click();
  const tx = page.getByRole("dialog", {
    name: "Identificar Movimento",
    exact: true,
  });
  await tx
    .getByRole("combobox", {
      name: "Grupo de Clientes (opcional)",
      exact: true,
    })
    .fill("Teste");
  await page.getByRole("option", { name: "Grupo Teste", exact: true }).click();
  await page.screenshot({
    path: "import-layout-customer-group-identification.png",
    fullPage: true,
  });
  await tx
    .getByRole("button", { name: "Salvar e fechar", exact: true })
    .click();
  await tx.waitFor({ state: "hidden" });
  const rows = (await api(base + "/transactions?state=identified")).rows;
  const grouped = rows.find((r) => r.raw_description.includes("COMUM"));
  assert.equal(grouped.customer_group_id, groups[0].id);
  assert.equal(grouped.party_id, null);
  await page
    .getByRole("button", { name: /Identificar movimento.*PAGADOR PREMIUM/ })
    .click();
  await tx
    .getByRole("combobox", {
      name: "Cliente / Fornecedor (opcional)",
      exact: true,
    })
    .fill("Premium");
  await page
    .getByRole("option", { name: "Cliente Premium", exact: true })
    .click();
  assert.equal(
    await tx
      .getByRole("combobox", {
        name: "Grupo de Clientes (opcional)",
        exact: true,
      })
      .count(),
    0,
  );
  await tx
    .getByRole("button", { name: "Salvar e fechar", exact: true })
    .click();
  await tx.waitFor({ state: "hidden" });
  const final = (await api(base + "/transactions?state=identified")).rows;
  assert.equal(
    final.find((r) => r.raw_description.includes("PREMIUM")).party_id,
    clients[0].id,
  );
  assert.equal(
    final.find((r) => r.raw_description.includes("PREMIUM")).customer_group_id,
    null,
  );
  await page.screenshot({
    path: "import-layout-customer-groups-history.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Cadastros", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Grupos de Clientes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar grupo Grupo Teste", exact: true })
    .click();
  await page.screenshot({
    path: "import-layout-customer-groups-mobile.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
