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
  name: "Ordenação dos menus sintética",
});
const base = "/organizations/" + org.id;
for (const [label, bank, number] of [
  ["Zeta", "033", "200"],
  ["Árvore", "001", "100"],
])
  await api(base + "/bank-accounts", {
    label,
    bank_code: bank,
    branch: "0001",
    account_number: number,
    account_digit: "1",
    currency: "BRL",
    active: true,
  });
const superior = await api(base + "/cost-centers", {
  name: "Superior sintético",
});
await api(base + "/cost-centers", {
  name: "Árvore 10",
  parent_id: superior.id,
});
await api(base + "/cost-centers", { name: "Beta 2" });
for (const [display_name, type] of [
  ["Zeta", "SUPPLIER"],
  ["Árvore", "CUSTOMER"],
  ["Beta", "BOTH"],
])
  await api(base + "/parties", { display_name, type });
let dimensions;
for (const [name, kind] of [
  ["Zeta sintética", "REVENUE"],
  ["Alfa sintética", "EXPENSE"],
  ["Beta sintética", "NEUTRAL"],
]) {
  const parent = await api(base + "/categories", { name, kind });
  const child = await api(base + "/subcategories", {
    name: "Zeta filha de " + name,
    category_id: parent.id,
  });
  await api(base + "/subcategories", {
    name: "Alfa filha de " + name,
    category_id: parent.id,
  });
  if (kind === "REVENUE")
    dimensions = {
      category_id: parent.id,
      subcategory_id: child.id,
      cost_center_id: superior.id,
    };
}
for (const [description, amount] of [
  ["Zeta prevista", "1000.00"],
  ["Alfa prevista", "20.00"],
])
  await api(base + "/planned-entries", {
    ...dimensions,
    request_key: crypto.randomUUID(),
    description,
    due_on: "2027-01-01",
    direction: "CREDIT",
    expected_amount: amount,
  });
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
  async function checkColumns(labels) {
    const table = page.getByRole("table");
    await table.waitFor();
    for (const label of labels) {
      const button = table.getByRole("button", {
        name: new RegExp(`^Ordenar por ${label}:`),
      });
      const header = table.getByRole("columnheader").filter({ has: button });
      await button.click();
      const first = await header.getAttribute("aria-sort");
      assert.ok(["ascending", "descending"].includes(first));
      await button.click();
      assert.notEqual(await header.getAttribute("aria-sort"), first);
    }
  }
  await checkColumns(["Nome da conta", "Código", "Banco", "Conta", "Situação"]);
  await page
    .getByRole("button", { name: /^Ordenar por Nome da conta:/ })
    .click();
  let names = await page.locator('tbody tr th[scope="row"]').allTextContents();
  const expected = [...names].sort(
    new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" }).compare,
  );
  const ascending =
    (await page
      .getByRole("columnheader")
      .filter({
        has: page.getByRole("button", { name: /^Ordenar por Nome da conta:/ }),
      })
      .getAttribute("aria-sort")) === "ascending";
  assert.deepEqual(names, ascending ? expected : expected.reverse());
  for (const [menu, labels] of [
    ["Centro de Custos", ["Nome", "Código", "Centro superior", "Situação"]],
    ["Clientes e Fornecedores", ["Nome", "Tipo", "Situação"]],
    ["Classificações", ["Nome", "Código", "Natureza", "Situação"]],
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: menu, exact: true })
      .click();
    await checkColumns(labels);
  }
  await page
    .getByRole("button", { name: "Expandir tudo", exact: true })
    .click();
  await page.getByRole("button", { name: /^Ordenar por Nome:/ }).click();
  const tree = await page
    .locator(".classification-tree tbody tr")
    .evaluateAll((rows) => {
      let parent = "";
      const result = [];
      for (const row of rows) {
        if (row.classList.contains("tree-parent"))
          parent = row.querySelector(".tree-disclosure").textContent;
        else if (
          row.classList.contains("tree-child") &&
          !row.classList.contains("tree-add")
        )
          result.push({ parent, child: row.querySelector("th").textContent });
      }
      return result;
    });
  assert.equal(tree.length, 6);
  for (const row of tree)
    assert.ok(
      ["Zeta sintética", "Alfa sintética", "Beta sintética"].some(
        (name) => row.parent.includes(name) && row.child.includes(name),
      ),
    );
  await page.screenshot({
    path: "import-layout-sort-classifications.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transações", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Lançamentos", exact: true })
    .click();
  await checkColumns([
    "Vencimento",
    "Descrição",
    "Previsto",
    "Realizado",
    "Em aberto",
    "Situação",
  ]);
  await page.screenshot({
    path: "import-layout-sort-planning.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
