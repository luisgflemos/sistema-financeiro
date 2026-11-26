import assert from "node:assert/strict";
import { chromium } from "playwright";

const endpoint = "http://127.0.0.1:8000";
async function api(path, body) {
  const response = await fetch(
    endpoint + path,
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
const org = await api("/organizations", {
  name: "Datas de extrato sintéticas",
});
const base = `/organizations/${org.id}`;
await api(base + "/bank-accounts", {
  label: "Conta sintética de datas",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  currency: "BRL",
  active: true,
});
const csv =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n24/01/2026;RECEBIMENTO SINTETICO A;01;100;200\n25/01/2026;DESPESA SINTETICA B;02;-30;170\n26/01/2026;RECEBIMENTO SINTETICO C;03;50;220\n";
const file = {
  name: "varios-dias.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(csv),
};
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
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
  let checks = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/statements/preview")) checks++;
  });
  await page
    .getByRole("button", { name: "Importar Extratos", exact: true })
    .click();
  await page
    .getByLabel("Arquivos de extrato", { exact: true })
    .setInputFiles(file);
  await page
    .getByRole("button", { name: "Verificar duplicidades", exact: true })
    .waitFor();
  assert.equal(checks, 0);
  await page
    .getByRole("button", { name: "Limpar seleção", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Verificar duplicidades", exact: true })
      .isEnabled(),
    false,
  );
  await page.getByRole("checkbox", { name: /^25\/01\/2026/ }).check();
  await page.screenshot({
    path: "import-layout-statement-dates-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "import-layout-statement-dates-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 850 });
  const pre = page.waitForResponse((response) =>
    response.url().endsWith("/statements/preview"),
  );
  await page
    .getByRole("button", { name: "Verificar duplicidades", exact: true })
    .click();
  const selection = await (await pre).json();
  assert.deepEqual(selection.files[0].selected_dates, ["2026-01-25"]);
  assert.equal(selection.files[0].rows.length, 1);
  await page
    .getByRole("button", { name: "Importar e identificar", exact: true })
    .click();
  await page.getByText("DESPESA SINTETICA B", { exact: true }).waitFor();
  assert.equal((await api(base + "/transactions?state=all")).total, 1);

  await page
    .getByRole("button", { name: "Importar Extratos", exact: true })
    .click();
  await page
    .getByLabel("Arquivos de extrato", { exact: true })
    .setInputFiles(file);
  await page
    .getByRole("button", { name: "Verificar duplicidades", exact: true })
    .waitFor();
  await page.getByRole("checkbox", { name: /^25\/01\/2026/ }).uncheck();
  const second = page.waitForResponse((response) =>
    response.url().endsWith("/statements/preview"),
  );
  await page
    .getByRole("button", { name: "Verificar duplicidades", exact: true })
    .click();
  assert.equal((await (await second).json()).new, 2);
  await page
    .getByRole("button", { name: "Importar e identificar", exact: true })
    .click();
  await page.getByText("RECEBIMENTO SINTETICO C", { exact: true }).waitFor();
  const rows = await api(base + "/transactions?state=all");
  assert.equal(rows.total, 3);
  assert.deepEqual([...new Set(rows.rows.map((row) => row.posted_on))].sort(), [
    "2026-01-24",
    "2026-01-25",
    "2026-01-26",
  ]);
  console.log(
    "Seleção de datas antes das duplicidades, importação parcial e layout aprovados.",
  );
} finally {
  await browser.close();
}
