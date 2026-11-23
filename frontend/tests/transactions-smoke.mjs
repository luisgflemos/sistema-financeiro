import assert from "node:assert/strict";
import { chromium } from "playwright";

const endpoint = "http://127.0.0.1:8000";
async function api(path, body) {
  const result = await fetch(
    endpoint + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  assert.ok(result.ok, await result.clone().text());
  return result.json();
}
const org = await api("/organizations", { name: "Transações sintéticas" });
const base = "/organizations/" + org.id;
await api(base + "/bank-accounts", {
  label: "Conta de extrato sintético",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  active: true,
  currency: "BRL",
});
const category = await api(base + "/categories", {
  name: "Receitas sintéticas",
  kind: "REVENUE",
});
await api(base + "/subcategories", {
  name: "Serviços sintéticos",
  category_id: category.id,
});
await api(base + "/cost-centers", { name: "Centro sintético" });
await api(base + "/parties", {
  display_name: "Cliente sintético",
  type: "CUSTOMER",
});
const csv =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;PIX CLIENTE SINTETICO;0001;100;150\n01/01/2026;TARIFA SINTETICA;0001;-10;50\n";

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
    .getByRole("heading", { name: "Transações", exact: true, level: 1 })
    .waitFor();
  await page
    .getByRole("button", { name: "Importar Extratos", exact: true })
    .click();
  await page.getByLabel("Arquivos de extrato", { exact: true }).setInputFiles({
    name: "sintetico.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page
    .getByText("Conta identificada pelo cabeçalho", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Importar e identificar", exact: true })
    .click();
  await page.getByText("PIX CLIENTE SINTETICO", { exact: true }).waitFor();
  await page.screenshot({
    path: "import-layout-transactions.png",
    fullPage: true,
  });
  const row = page
    .getByRole("row")
    .filter({ hasText: "PIX CLIENTE SINTETICO" });
  await row.getByRole("button", { name: /Identificar movimento/ }).click();
  await page
    .getByRole("button", { name: "← Voltar à visão geral", exact: true })
    .click();
  await row.getByRole("button", { name: /Identificar movimento/ }).click();
  for (const [label, value] of [
    ["Cliente / Fornecedor", "Cliente sintético"],
    ["Classificação", "Receitas sintéticas"],
    ["Subclassificação", "Serviços sintéticos"],
    ["Centro de Custos", "Centro sintético"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("option", { name: value, exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Salvar e próximo", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("TARIFA SINTETICA", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "← Voltar à visão geral", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transações", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Transações", level: 1, exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "import-layout-transactions-mobile.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
