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
const org = await api("/organizations", { name: "Recorrência sintética" });
const base = "/organizations/" + org.id;
const category = await api(base + "/categories", {
  name: "Estrutura sintética",
  kind: "EXPENSE",
});
await api(base + "/subcategories", {
  name: "Energia sintética",
  category_id: category.id,
});
await api(base + "/cost-centers", { name: "Centro sintético" });
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
  await nav.getByRole("button", { name: "Lançamentos", exact: true }).click();
  await page.getByRole("button", { name: "Nova Despesa", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Nova Despesa",
    exact: true,
  });
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Energia recorrente sintética");
  await dialog.getByLabel("Vencimento", { exact: true }).fill("2026-11-27");
  const money = dialog.getByLabel("Valor previsto (R$)", { exact: true });
  await money.pressSequentially("500");
  assert.equal(
    await money.inputValue(),
    "500,00",
    "Digitar 500 mantém os centavos visíveis",
  );
  await money.press(",");
  await money.pressSequentially("50");
  assert.equal(await money.inputValue(), "500,50");
  await money.fill("500.00");
  assert.equal(
    await money.inputValue(),
    "500,00",
    "Colar um decimal também aplica a máscara brasileira",
  );
  for (const [label, option] of [
    ["Classificação", "Estrutura sintética"],
    ["Subclassificação", "Energia sintética"],
    ["Centro de Custos", "Centro sintético"],
  ]) {
    await dialog.getByLabel(label, { exact: true }).fill(option);
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  // Enter on an ordinary field must not create an accidental single entry
  // before the operator reaches the recurrence controls.
  await money.press("Enter");
  assert.equal((await api(base + "/planned-entries")).total, 0);
  await dialog.getByLabel("Recorrência", { exact: true }).fill("mens");
  await dialog.getByLabel("Recorrência", { exact: true }).press("Enter");
  const count = dialog.getByLabel("Quantidade de ocorrências", { exact: true });
  await count.fill("4");
  await count.press("Enter");
  assert.equal((await api(base + "/planned-entries")).total, 0);
  await dialog
    .getByRole("status")
    .filter({ hasText: "4 lançamentos mensais" })
    .waitFor();
  const save = dialog.getByRole("button", {
    name: "Criar 4 Lançamentos",
    exact: true,
  });
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1100, 768],
  ]) {
    await page.setViewportSize({ width, height });
    const layout = await dialog.evaluate((element) => ({
      scroll: element.scrollHeight > element.clientHeight + 2,
      horizontal: element.scrollWidth > element.clientWidth + 2,
    }));
    assert.equal(
      layout.scroll,
      false,
      `Formulário completo sem rolagem em ${width}x${height}`,
    );
    assert.equal(layout.horizontal, false);
    assert.ok(await save.isVisible());
    await page.screenshot({
      path: `import-layout-recurring-${width}.png`,
      fullPage: true,
    });
  }
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/planned-entries"),
  );
  await save.click();
  const payload = (await requestPromise).postDataJSON();
  assert.equal(payload.frequency, "MONTHLY");
  assert.equal(payload.occurrences, 4);
  assert.equal(payload.expected_amount, "500.00");
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("status")
    .filter({ hasText: "4 lançamento(s) previsto(s) criado(s)." })
    .waitFor();
  const data = await api(base + "/planned-entries");
  assert.equal(data.total, 4);
  assert.deepEqual(
    data.rows.map((row) => row.due_on),
    ["2026-11-27", "2026-12-27", "2027-01-27", "2027-02-27"],
  );
  assert.deepEqual(
    data.rows.map((row) => row.occurrence),
    [1, 2, 3, 4],
  );
  assert.ok(
    data.rows.every(
      (row) => row.occurrences === 4 && row.expected_amount === "500.00",
    ),
  );
  assert.equal(data.totals.payable, "2000.00");
  assert.equal((await api(base + "/transactions")).total, 0);
  await page
    .getByRole("row")
    .filter({ hasText: "27/11/2026" })
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  const editing = page.getByRole("dialog", {
    name: "Editar Lançamento",
    exact: true,
  });
  assert.equal(
    await editing
      .getByLabel("Valor previsto (R$)", { exact: true })
      .inputValue(),
    "500,00",
  );
  await page.screenshot({
    path: "import-layout-recurring-edit.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await editing.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 2,
    ),
    false,
  );
  await page.screenshot({
    path: "import-layout-recurring-mobile.png",
    fullPage: true,
  });
  await editing
    .getByLabel("Valor previsto (R$)", { exact: true })
    .fill("1.234,56");
  await editing
    .getByRole("button", { name: "Salvar Lançamento", exact: true })
    .click();
  await editing.waitFor({ state: "hidden" });
  const changed = await api(base + "/planned-entries");
  assert.equal(changed.total, 4);
  assert.equal(changed.rows[0].expected_amount, "1234.56");
  assert.ok(
    changed.rows.slice(1).every((row) => row.expected_amount === "500.00"),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const firstRow = page.getByRole("row").filter({ hasText: "27/11/2026" });
  await firstRow.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Cancelar Lançamento", exact: true })
    .getByRole("button", { name: "Confirmar cancelamento", exact: true })
    .click();
  await firstRow.waitFor({ state: "hidden" });
  assert.equal((await api(base + "/planned-entries?state=active")).total, 3);
  await page
    .getByLabel("Situação dos lançamentos", { exact: true })
    .fill("Todas");
  await page
    .getByRole("option", { name: "Todas as situações", exact: true })
    .click();
  await firstRow.getByText("Cancelado", { exact: true }).waitFor();
  assert.equal(await firstRow.locator(".planning-state-cancelled").count(), 1);
  assert.equal(await page.locator(".planning-state-upcoming").count(), 3);
  const colours = await page
    .locator(".planning-state-cancelled, .planning-state-upcoming")
    .evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).backgroundColor),
    );
  assert.equal(new Set(colours).size, 2);
  await page.screenshot({
    path: "import-layout-planning-states.png",
    fullPage: true,
  });
  await firstRow.getByRole("button", { name: "Excluir", exact: true }).click();
  const exclusion = page.getByRole("dialog", {
    name: "Excluir Lançamento",
    exact: true,
  });
  await exclusion
    .getByRole("status")
    .filter({ hasText: "1 lançamento(s) selecionado(s)" })
    .waitFor();
  await exclusion
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await exclusion.waitFor({ state: "hidden" });
  await firstRow.waitFor({ state: "hidden" });
  assert.equal((await api(base + "/planned-entries?state=all")).total, 3);
  const third = page.getByRole("row").filter({ hasText: "27/01/2027" });
  await third.getByRole("button", { name: "Excluir", exact: true }).click();
  await exclusion
    .getByLabel("Quais ocorrências excluir?", { exact: true })
    .fill("próximas");
  await page
    .getByRole("option", {
      name: "Esta e as próximas ocorrências",
      exact: true,
    })
    .click();
  await exclusion
    .getByRole("status")
    .filter({ hasText: "2 lançamento(s) selecionado(s)" })
    .waitFor();
  await page.screenshot({
    path: "import-layout-planning-exclusion.png",
    fullPage: true,
  });
  await exclusion
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await exclusion.waitFor({ state: "hidden" });
  await third.waitFor({ state: "hidden" });
  const remaining = await api(base + "/planned-entries?state=all");
  assert.equal(remaining.total, 1);
  assert.equal(remaining.rows[0].due_on, "2026-12-27");
  assert.equal(remaining.totals.payable, "500.00");
} catch (error) {
  await page.screenshot({
    path: "import-layout-recurring-error.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
