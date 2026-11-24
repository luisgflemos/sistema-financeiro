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
const org = await api("/organizations", { name: "Retirada sintética" });
const base = "/organizations/" + org.id;
await api(base + "/bank-accounts", {
  label: "Conta sintética de teste",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  active: true,
  currency: "BRL",
});
const payload = {
  files: [
    {
      file_name: "lote-teste.csv",
      content: Buffer.from(
        "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;PIX SINTETICO;01;100;150\n01/01/2026;TARIFA SINTETICA;02;-10;50\n",
      ).toString("base64"),
    },
  ],
};
const preview = await api(base + "/statements/preview", payload);
await api(base + "/statements/commit", { ...payload, token: preview.token });
const accounts = await api(base + "/bank-accounts");
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
    .getByRole("button", { name: "Retirar Lote de Teste", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Retirar Lote de Teste",
    exact: true,
  });
  await modal.getByLabel("Extrato do teste", { exact: true }).click();
  await page
    .getByRole("option", {
      name: "Conta sintética de teste · lote-teste.csv",
      exact: true,
    })
    .click();
  await modal.getByText("2 movimentos", { exact: true }).waitFor();
  await page.screenshot({
    path: "import-layout-cleanup-preview.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", {
      name: "Retirar Movimentos deste Extrato",
      exact: true,
    })
    .click();
  await modal
    .getByRole("status")
    .filter({ hasText: "2 movimentos retirados" })
    .waitFor();
  assert.equal((await api(base + "/transactions")).total, 0);
  assert.deepEqual(await api(base + "/bank-accounts"), accounts);
  await page.screenshot({
    path: "import-layout-cleanup-result.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "Restaurar Lote", exact: true })
    .click();
  await modal
    .getByRole("status")
    .filter({ hasText: "2 movimentos restaurados" })
    .waitFor();
  assert.equal((await api(base + "/transactions")).total, 2);
  assert.deepEqual(await api(base + "/bank-accounts"), accounts);
} finally {
  await browser.close();
}
