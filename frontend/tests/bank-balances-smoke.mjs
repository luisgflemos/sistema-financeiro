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
const org = await api("/organizations", {
  name: "Saldos bancários sintéticos",
});
const base = "/organizations/" + org.id;
const a = await api(base + "/bank-accounts", {
  label: "Conta com saldo",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  currency: "BRL",
  active: true,
});
const b = await api(base + "/bank-accounts", {
  label: "Conta sem referência",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "7",
  currency: "BRL",
  active: true,
});
const csv =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;PAGAMENTO SINTETICO;02;-30;170\n02/01/2026;RECEBIMENTO SINTETICO;01;100;200\n";
const files = [
  {
    file_name: "saldo-sintetico.csv",
    content: Buffer.from(csv).toString("base64"),
  },
];
const preview = await api(base + "/statements/preview", { files });
await api(base + "/statements/commit", { files, token: preview.token });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate(
    (id) => localStorage.setItem("autovisao.organization", id),
    org.id,
  );
  await page.reload();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Transações", exact: true }).click();
  await nav
    .getByRole("button", { name: "Extrato Bancário", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Extrato Bancário", exact: true })
    .waitFor();
  await page.getByText("Referências conferem", { exact: true }).waitFor();
  const received = page
    .getByRole("row")
    .filter({ hasText: "RECEBIMENTO SINTETICO" });
  await received.waitFor();
  const paid = page.getByRole("row").filter({ hasText: "PAGAMENTO SINTETICO" });
  assert.ok((await received.innerText()).includes("200,00"));
  assert.ok((await paid.innerText()).includes("170,00"));
  assert.equal(
    await page
      .getByRole("button", { name: "Informar Saldo de Abertura", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: "import-layout-bank-balances-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ajustar Saldo", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Valor (BRL)", { exact: true }).fill("20,00");
  await dialog
    .getByLabel("Justificativa", { exact: true })
    .fill("Ajuste sintético de conferência");
  await dialog.getByLabel("Efeito do ajuste", { exact: true }).fill("Diminuir");
  await page
    .getByRole("option", { name: "Diminuir saldo", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Salvar referência", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByText("Registro de saldo salvo. Extrato original preservado.", {
      exact: true,
    })
    .waitFor();
  let result = await api(base + "/bank-balances/" + a.id);
  assert.equal(result.summary.calculated_balance, "150.00");
  assert.equal(result.totals.credits, "100.00");
  assert.equal(result.totals.debits, "30.00");
  await page
    .getByRole("button", { name: "Referências e Ajustes", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Estornar registro de saldo", exact: true })
    .click();
  const reversal = page.getByRole("dialog", {
    name: "Estornar Registro de Saldo",
    exact: true,
  });
  await reversal
    .getByLabel("Motivo do estorno")
    .fill("Estorno sintético de teste");
  await reversal
    .getByRole("button", { name: "Confirmar estorno", exact: true })
    .click();
  await reversal.waitFor({ state: "hidden" });
  await page
    .getByText("Registro de saldo estornado. Histórico preservado.", {
      exact: true,
    })
    .waitFor();
  result = await api(base + "/bank-balances/" + a.id);
  assert.equal(result.summary.calculated_balance, "170.00");
  await page
    .getByRole("button", {
      name: "Ver extrato de Conta sem referência",
      exact: true,
    })
    .click();
  await page
    .getByText("Falta uma referência de saldo.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Informar Saldo de Abertura", exact: true })
    .first()
    .click();
  const opening = page.getByRole("dialog");
  await opening.getByLabel("Valor (BRL)", { exact: true }).fill("100,00");
  await opening
    .getByLabel("Situação do saldo", { exact: true })
    .fill("negativo");
  await page
    .getByRole("option", { name: "Saldo negativo", exact: true })
    .click();
  await opening
    .getByLabel("Justificativa", { exact: true })
    .fill("Saldo de abertura sintético");
  await page.screenshot({
    path: "import-layout-bank-opening.png",
    fullPage: true,
  });
  await opening
    .getByRole("button", { name: "Salvar referência", exact: true })
    .click();
  await opening.waitFor({ state: "hidden" });
  await page
    .getByText("Registro de saldo salvo. Extrato original preservado.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await api(base + "/bank-balances/" + b.id)).summary.calculated_balance,
    "-100.00",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "import-layout-bank-balances-mobile.png",
    fullPage: true,
  });
  console.log(
    "Saldos automáticos, abertura somente quando necessária, ajustes, estornos e layout aprovados.",
  );
} finally {
  await browser.close();
}
