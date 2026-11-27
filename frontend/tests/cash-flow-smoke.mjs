import assert from "node:assert/strict";
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
const org = await api("/organizations", { name: "Fluxo sintético" });
const base = "/organizations/" + org.id;
const account = await api(base + "/bank-accounts", {
  label: "Conta sintética",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  currency: "BRL",
  active: true,
});
const category = await api(base + "/categories", {
  name: "Despesas Estruturais Sintéticas",
  kind: "EXPENSE",
});
const sub = await api(base + "/subcategories", {
  name: "Água Sintética",
  category_id: category.id,
});
const center = await api(base + "/cost-centers", { name: "Unidade Sintética" });
let csv =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n";
for (let m = 6; m >= 1; m--)
  csv += `15/${String(m).padStart(2, "0")}/2026;AGUA SINTETICA;${m};-500;${10000 - m * 500}\n`;
const files = [
  {
    file_name: "fluxo-sintetico.csv",
    content: Buffer.from(csv).toString("base64"),
  },
];
const preview = await api(base + "/statements/preview", { files });
await api(base + "/statements/commit", { files, token: preview.token });
for (const t of (await api(base + "/transactions")).rows)
  await api(
    base + "/transactions/" + t.id + "/identification",
    {
      category_id: category.id,
      subcategory_id: sub.id,
      cost_center_id: center.id,
      movement_kind: "NORMAL",
    },
    "PUT",
  );
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
  await nav.getByRole("button", { name: "Gerencial", exact: true }).click();
  await nav
    .getByRole("button", { name: "Fluxo de Caixa", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Sugestões do Fin", exact: true })
    .waitFor();
  assert.ok(
    (await page.locator(".toolbar-title").innerText()).includes("Gerencial"),
  );
  assert.equal((await api(base + "/planned-entries")).total, 0);
  let report = await api(base + "/cash-flow");
  assert.ok(Number(report.totals.forecast_debit) > 0);
  await page.screenshot({
    path: "import-layout-cash-flow-desktop.png",
    fullPage: true,
  });
  const july = page
    .getByRole("row")
    .filter({ hasText: "jul." })
    .filter({ hasText: "Água Sintética" });
  await july
    .getByRole("button", { name: "Ajustar estimativa", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", {
      name: "Orçamento estimado do mês (antes das coberturas)",
      exact: true,
    })
    .fill("600,00");
  await dialog
    .getByRole("textbox", { name: "Justificativa", exact: true })
    .fill("Revisão sintética de teste");
  await dialog
    .getByRole("button", { name: "Confirmar revisão", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByText("Estimativa revisada. Movimentos e compromissos preservados.", {
      exact: true,
    })
    .waitFor();
  await july.getByText("Revisado pelo operador", { exact: true }).waitFor();
  report = await api(base + "/cash-flow");
  assert.equal(
    report.patterns.find((p) => p.period === "2026-07-01").target,
    "600.00",
  );
  await july
    .getByRole("button", { name: "Restaurar estimativa", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Justificativa", exact: true })
    .fill("Restaurar cenário sintético");
  await dialog
    .getByRole("button", { name: "Confirmar revisão", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await july
    .getByRole("button", { name: "Desconsiderar estimativa", exact: true })
    .waitFor();
  await july
    .getByRole("button", { name: "Criar lançamento", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Vencimento", { exact: true }).fill("2026-07-15");
  await dialog
    .getByRole("combobox", { name: "Recorrência da projeção", exact: true })
    .fill("Mensal");
  await page.getByRole("option", { name: "Mensal", exact: true }).click();
  await dialog.getByLabel("Quantidade de meses", { exact: true }).fill("2");
  await page.screenshot({
    path: "import-layout-cash-flow-convert.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Confirmar criação", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByText(
      "2 lançamento(s) criado(s). A projeção será recalculada para evitar duplicidade.",
      { exact: true },
    )
    .waitFor();
  report = await api(base + "/cash-flow");
  assert.equal(report.totals.forecast_debit, "0.00");
  assert.equal(report.totals.registered_debit, "1000.00");
  assert.equal((await api(base + "/planned-entries")).total, 2);
  await page
    .getByRole("button", { name: "Conversar com Fin", exact: true })
    .click();
  await page
    .getByRole("region", {
      name: "Conversa com Assistente Finare",
      exact: true,
    })
    .waitFor();

  await page
    .getByRole("button", { name: "Minimizar assistente", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Agrupar fluxo", exact: true })
    .fill("Diário");
  await page.getByRole("option", { name: "Diário", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "import-layout-cash-flow-mobile.png",
    fullPage: true,
  });
  console.log(
    "Fluxo preditivo sem compromissos, revisão, criação recorrente, redução da estimativa e menu Gerencial aprovados.",
  );
} finally {
  await browser.close();
}
