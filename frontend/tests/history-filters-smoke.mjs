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
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;RECEITA SINTETICA A;01;100;150\n02/01/2026;RECEITA SINTETICA B;02;200;350\n02/01/2026;DESPESA SINTETICA C;03;-30;320\n";
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
  assert.equal(
    await page
      .getByRole("button", { name: "Vincular Clientes", exact: true })
      .count(),
    0,
  );
  async function select(label, search, option, total) {
    await page.getByRole("combobox", { name: label, exact: true }).fill(search);
    await page.getByRole("option", { name: option, exact: true }).click();
    await page.getByText(`${total} resultados`, { exact: true }).waitFor();
  }
  await select("Classificação", "serv", category.name, 2);
  await select("Subclassificação", "b", subB.name, 1);
  await select("Cliente / Fornecedor", "beta", partyB.display_name, 1);
  await select("Centro de Custos", "beta", centerB.name, 1);
  await page.screenshot({
    path: "import-layout-history-filters-desktop.png",
    fullPage: true,
  });
  await select("Classificação", "desp", expense.name, 1);
  assert.equal(
    await page
      .getByRole("combobox", { name: "Subclassificação", exact: true })
      .inputValue(),
    "Todos",
  );
  await page.getByText("DESPESA SINTETICA C", { exact: true }).waitFor();
  await select("Classificação", "Todos", "Todos", 2);
  await select("Cliente / Fornecedor", "Todos", "Todos", 2);
  await select("Centro de Custos", "Todos", "Todos", 3);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "import-layout-history-filters-mobile.png",
    fullPage: true,
  });
  console.log(
    "Filtros pesquisáveis do Histórico, dependência de subclassificação e combinações aprovados.",
  );
} finally {
  await browser.close();
}
