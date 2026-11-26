import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
async function api(path, body, method = "POST") {
  const response = await fetch(
    "http://127.0.0.1:8000" + path,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
const org = await api("/organizations", {
  name: "Conferência de baixas sintética",
});
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
const category = await api(base + "/categories", {
  name: "Receita sintética",
  kind: "REVENUE",
});
const sub = await api(base + "/subcategories", {
  name: "Serviço sintético",
  category_id: category.id,
});
const center = await api(base + "/cost-centers", { name: "Loja sintética" });
const party = await api(base + "/parties", {
  display_name: "Cliente Alfa",
  type: "CUSTOMER",
});
const other = await api(base + "/parties", {
  display_name: "Cliente Beta",
  type: "CUSTOMER",
});
async function plan(description, amount, client = party.id) {
  await api(base + "/planned-entries", {
    request_key: randomUUID(),
    description,
    due_on: "2026-01-01",
    direction: "CREDIT",
    expected_amount: amount,
    category_id: category.id,
    subcategory_id: sub.id,
    cost_center_id: null,
    party_id: client,
  });
}
await plan("Título exato Alfa", "100.00");
await plan("Título desconto Alfa", "120.00");
await plan("Título Beta", "200.00", other.id);
const csv =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;PIX TESTE PARCIAL;03;30;250\n02/01/2026;PIX TESTE DESCONTO;02;70;220\n02/01/2026;PIX TESTE EXATO;01;100;150\n";
const files = [
  { file_name: "baixas.csv", content: Buffer.from(csv).toString("base64") },
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
  async function select(label, value) {
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: label, exact: true })
      .fill(value);
    await page.getByRole("option", { name: value, exact: true }).click();
  }
  async function open(description) {
    await page
      .getByRole("row")
      .filter({ hasText: description })
      .getByRole("button", { name: /Identificar movimento/ })
      .click();
  }
  await open("PIX TESTE EXATO");
  // Nenhuma confirmação é necessária para pesquisar os títulos do cliente sugerido.
  await select("Cliente / Fornecedor (opcional)", "Cliente Alfa");
  const suggestion = page.getByRole("button", {
    name: /Título exato Alfa.*Conferir vínculo/,
  });
  await suggestion.waitFor();
  assert.ok(
    (await api(base + "/transactions?state=all")).rows.every(
      (r) => r.version === 0,
    ),
  );
  await select("Cliente / Fornecedor (opcional)", "Cliente Beta");
  await page
    .getByRole("button", { name: /Título Beta.*Conferir vínculo/ })
    .waitFor();
  assert.equal(
    await suggestion.count(),
    0,
    "Trocar cliente descarta sugestões anteriores",
  );
  await select("Cliente / Fornecedor (opcional)", "Cliente Alfa");
  await suggestion.click();
  await page.getByText("Identificação da baixa", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Vincular e dar baixa", exact: true })
      .isEnabled(),
    false,
  );
  await select("Centro de Custos da baixa", "Loja sintética");
  await page.screenshot({
    path: "import-layout-settlement-exact.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Vincular e dar baixa", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  let titles = await api(base + "/planned-entries");
  let exact = titles.rows.find((r) => r.description === "Título exato Alfa");
  assert.equal(exact.outstanding, "0.00");
  assert.equal(exact.cost_center_id, null);
  assert.equal(exact.situation, "paid");
  await open("PIX TESTE DESCONTO");
  await select("Cliente / Fornecedor (opcional)", "Cliente Alfa");
  await page
    .getByRole("button", { name: /Título desconto Alfa.*Conferir vínculo/ })
    .click();
  await select("Centro de Custos da baixa", "Loja sintética");
  await select(
    "Tratamento da diferença",
    "Desconto comercial — quitar o saldo",
  );
  const save = page.getByRole("button", {
    name: "Vincular e dar baixa",
    exact: true,
  });
  assert.equal(await save.isEnabled(), false);
  await page
    .getByRole("checkbox", { name: /Confirmo a baixa com diferença/ })
    .check();
  const saveBounds = await save.boundingBox();
  assert.equal(
    await page.getByText(/Nenhum lançamento em aberto encontrado/).count(),
    0,
  );
  assert.ok(
    saveBounds.y + saveBounds.height <= 900,
    "Baixa com diferença cabe no desktop sem esconder a ação principal",
  );
  await page.screenshot({
    path: "import-layout-settlement-discount.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "import-layout-settlement-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await save.click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  titles = await api(base + "/planned-entries");
  const discounted = titles.rows.find(
    (r) => r.description === "Título desconto Alfa",
  );
  assert.equal(discounted.discount, "50.00");
  assert.equal(discounted.paid, "70.00");
  assert.equal(discounted.outstanding, "0.00");
  await plan("Título parcial Alfa", "100.00");
  await open("PIX TESTE PARCIAL");
  await select("Cliente / Fornecedor (opcional)", "Cliente Alfa");
  await page
    .getByRole("button", { name: /Título parcial Alfa.*Conferir vínculo/ })
    .click();
  await select("Centro de Custos da baixa", "Loja sintética");
  await page
    .getByRole("button", { name: "Vincular e dar baixa", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await nav.getByRole("button", { name: "Lançamentos", exact: true }).click();
  const partial = page
    .getByRole("row")
    .filter({ hasText: "Título parcial Alfa" });
  await partial.getByText("Baixa parcial", { exact: true }).waitFor();
  await partial.getByText("Vencido", { exact: true }).waitFor();
  await page
    .getByRole("row")
    .filter({ hasText: "Título exato Alfa" })
    .getByText("Baixado", { exact: true })
    .waitFor();
  assert.equal((await api(base + "/planned-entries?state=overdue")).total, 2);
  const overdueColor = await partial
    .getByText("Vencido", { exact: true })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const paidColor = await page
    .getByRole("row")
    .filter({ hasText: "Título exato Alfa" })
    .getByText("Baixado", { exact: true })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(overdueColor, "rgb(254, 226, 226)");
  assert.equal(paidColor, "rgb(209, 250, 229)");
  await page.screenshot({
    path: "import-layout-settlement-states.png",
    fullPage: true,
  });
  const movements = (await api(base + "/transactions?state=all")).rows;
  assert.deepEqual(movements.map((r) => r.amount).sort(), [
    "100.00",
    "30.00",
    "70.00",
  ]);
  assert.ok(movements.every((r) => r.cost_center_id === center.id));
  console.log(
    "Sugestões por cliente sem confirmação prévia, troca de cliente, dados da baixa, desconto, parcial e situações aprovados.",
  );
} finally {
  await browser.close();
}
