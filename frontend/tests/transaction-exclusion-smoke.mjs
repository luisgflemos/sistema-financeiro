import assert from "node:assert/strict";
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
const org = await api("/organizations", { name: "Exclusão sintética" });
const base = "/organizations/" + org.id;
await api(base + "/bank-accounts", {
  label: "Conta sintética",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  currency: "BRL",
  active: true,
});
const content =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n" +
  Array.from(
    { length: 105 },
    (_, i) => `02/01/2026;MOVIMENTO SINTETICO ${i};${i};1;${105 - i}\n`,
  ).join("");
const files = [
  {
    file_name: "selecionar-sintetico.csv",
    content: Buffer.from(content).toString("base64"),
  },
];
const preview = await api(base + "/statements/preview", { files });
await api(base + "/statements/commit", { files, token: preview.token });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate(
    (id) => localStorage.setItem("autovisao.organization", id),
    org.id,
  );
  await page.reload();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Transações", exact: true }).click();
  await page.getByText("105 resultados", { exact: true }).waitFor();
  const pending = page.locator(".transaction-state-pending").first();
  assert.equal(
    await pending.evaluate((node) => getComputedStyle(node).color),
    "rgb(153, 27, 27)",
  );
  await page
    .getByRole("checkbox", {
      name: "Selecionar movimentos desta página",
      exact: true,
    })
    .check();
  await page.getByText("100 selecionados", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "Selecionar todos os resultados",
      exact: true,
    })
    .click();
  await page.getByText("105 selecionados", { exact: true }).waitFor();
  await page
    .getByRole("checkbox", { name: /^Selecionar movimento:/ })
    .first()
    .uncheck();
  await page.getByText("104 selecionados", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Limpar seleção", exact: true })
    .click();
  await page.getByText("0 selecionados", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "Selecionar todos os resultados",
      exact: true,
    })
    .click();
  await page.getByText("105 selecionados", { exact: true }).waitFor();
  await page.screenshot({
    path: "import-layout-transaction-selection.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Excluir selecionados", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Excluir Movimentos Selecionados",
    exact: true,
  });
  await dialog
    .getByText("105 movimentos serão excluídos", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "import-layout-transaction-exclusion-preview.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Voltar sem excluir", exact: true })
    .click();
  assert.equal((await api(base + "/transactions?state=all")).total, 105);
  await page
    .getByRole("button", { name: "Excluir selecionados", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("105 movimentos excluídos.", { exact: true }).waitFor();
  await page.getByText("0 resultados", { exact: true }).waitFor();
  assert.equal((await api(base + "/transactions?state=all")).total, 0);
  assert.equal((await api(base + "/bank-accounts")).length, 1);
  await nav.getByRole("button", { name: "Histórico", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Excluir selecionados", exact: true })
      .count(),
    0,
  );
  await nav
    .getByRole("button", { name: "Importar Extrato", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar Extratos", exact: true })
    .click();
  await page.getByLabel("Arquivos de extrato", { exact: true }).setInputFiles({
    name: files[0].file_name,
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  await page
    .getByRole("button", { name: "Verificar duplicidades", exact: true })
    .click();
  await page
    .getByText(
      "105 movimentos excluídos serão reimportados para identificação.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({
    path: "import-layout-statement-reimport.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Importar e identificar", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("105 resultados", { exact: true }).waitFor();
  assert.equal((await api(base + "/transactions?state=pending")).total, 105);
  assert.equal((await api(base + "/transactions?state=identified")).total, 0);
} catch (error) {
  await page.screenshot({
    path: "import-layout-transaction-exclusion-error.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
