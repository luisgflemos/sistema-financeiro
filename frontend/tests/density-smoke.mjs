import assert from "node:assert/strict";
import { chromium } from "playwright";
const endpoint = "http://127.0.0.1:8000";
async function api(path, body, method = "POST") {
  const result = await fetch(
    endpoint + path,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  assert.ok(result.ok, await result.clone().text());
  return result.json();
}
const org = await api("/organizations", {
  name: "Filtros de histórico sintéticos",
});
const base = `/organizations/${org.id}`;
await api(base + "/bank-accounts", {
  label: "Conta sintética",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  currency: "BRL",
  active: true,
});
const category = await api(base + "/categories", {
  name: "Receitas de Serviços",
  kind: "REVENUE",
});
const expense = await api(base + "/categories", {
  name: "Despesas Operacionais",
  kind: "EXPENSE",
});
const subA = await api(base + "/subcategories", {
  name: "Serviço A",
  category_id: category.id,
});
const subB = await api(base + "/subcategories", {
  name: "Serviço B",
  category_id: category.id,
});
const subC = await api(base + "/subcategories", {
  name: "Material",
  category_id: expense.id,
});
const centerA = await api(base + "/cost-centers", { name: "Centro Alfa" });
const centerB = await api(base + "/cost-centers", { name: "Centro Beta" });
const partyA = await api(base + "/parties", {
  display_name: "Contraparte Alfa",
  type: "BOTH",
});
const partyB = await api(base + "/parties", {
  display_name: "Contraparte Beta",
  type: "BOTH",
});
const csv =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;DESPESA SINTETICA C;03;-30;320\n02/01/2026;RECEITA SINTETICA B;02;200;350\n02/01/2026;RECEITA SINTETICA A;01;100;150\n";
const files = [
  { file_name: "filtros.csv", content: Buffer.from(csv).toString("base64") },
];
const preview = await api(base + "/statements/preview", { files });
await api(base + "/statements/commit", { files, token: preview.token });
const imported = (await api(base + "/transactions?state=all")).rows;
for (const row of imported) {
  const isA = row.raw_description.endsWith(" A");
  const isC = row.direction === "DEBIT";
  await api(
    base + `/transactions/${row.id}/identification`,
    {
      movement_kind: "NORMAL",
      category_id: isC ? expense.id : category.id,
      subcategory_id: isC ? subC.id : isA ? subA.id : subB.id,
      party_id: isA ? partyA.id : partyB.id,
      cost_center_id: isA ? centerA.id : centerB.id,
    },
    "PUT",
  );
}
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate(
    (id) => localStorage.setItem("autovisao.organization", id),
    org.id,
  );
  await page.reload();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Transações", exact: true }).click();
  await nav.getByRole("button", { name: "Histórico", exact: true }).click();
  await page.getByText("3 resultados", { exact: true }).waitFor();
  const row = page.getByRole("row").filter({ hasText: "DESPESA SINTETICA C" });
  const metrics = await row.evaluate((el) => ({
    rowTop: el.getBoundingClientRect().top,
    rowHeight: el.getBoundingClientRect().height,
    font: parseFloat(getComputedStyle(el.querySelector("td")).fontSize),
    header: document.querySelector(".toolbar").getBoundingClientRect().height,
  }));
  console.log("Densidade desktop", JSON.stringify(metrics));
  assert.ok(metrics.header <= 68, "Barra superior compacta");
  assert.ok(metrics.rowTop <= 370, "Maioria da tela disponível aos registros");
  assert.ok(metrics.rowHeight <= 60, "Linhas compactas e legíveis");
  assert.ok(metrics.font >= 14, "Preservar legibilidade da tabela");
  await page.screenshot({
    path: "import-layout-density-history.png",
    fullPage: true,
  });
  await nav.getByRole("button", { name: "Cadastros", exact: true }).click();
  await nav
    .getByRole("button", { name: "Contas Bancárias", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Novo cadastro", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const agency = await dialog
    .getByLabel("Agência", { exact: true })
    .boundingBox();
  const number = await dialog
    .getByLabel("Número da conta", { exact: true })
    .boundingBox();
  assert.ok(
    Math.abs(agency.y - number.y) < 2 && number.x > agency.x,
    "Campos curtos lado a lado",
  );
  await page.screenshot({
    path: "import-layout-density-bank.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileAgency = await dialog
    .getByLabel("Agência", { exact: true })
    .boundingBox();
  const mobileNumber = await dialog
    .getByLabel("Número da conta", { exact: true })
    .boundingBox();
  assert.ok(mobileNumber.y > mobileAgency.y, "Uma coluna no celular");
  assert.ok(mobileAgency.height >= 44, "Área de toque preservada");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "import-layout-density-mobile.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
