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
const org = await api("/organizations", { name: "Origem da IA sintética" });
const base = "/organizations/" + org.id;
await api(base + "/bank-accounts", {
  label: "Banco sintético",
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
  name: "PIX sintético",
  category_id: category.id,
});
const center = await api(base + "/cost-centers", { name: "Centro sugerido" });
const manualCenter = await api(base + "/cost-centers", {
  name: "Centro manual",
});
const party = await api(base + "/parties", {
  display_name: "Cliente sintético",
  type: "CUSTOMER",
});
const files = [
  {
    file_name: "sintetico.csv",
    content: Buffer.from(
      "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;PIX CLIENTE SINTETICO;01;100;150\n",
    ).toString("base64"),
  },
];
const preview = await api(base + "/statements/preview", { files });
await api(base + "/statements/commit", { files, token: preview.token });
const original = (await api(base + "/transactions?state=all")).rows[0];
let confidence = "HIGH",
  saved = false,
  captured;
const suggestion = {
  party_id: party.id,
  category_id: category.id,
  subcategory_id: sub.id,
  cost_center_id: center.id,
  movement_kind: "NORMAL",
};
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  // Somente apresentação: Responses e gravação são simulados neste teste de UI.
  // Regras de validação, auditoria e reavaliação usam testes separados da API real.
  await page.route("**/api" + base + "/transactions?**", async (route) => {
    const state = new URL(route.request().url()).searchParams.get("state");
    const row = saved
      ? {
          ...original,
          ...captured,
          version: 1,
          state: "identified",
          suggestion: null,
          suggestion_id: null,
          confidence: null,
          reason: null,
        }
      : {
          ...original,
          version: 0,
          state: "suggested",
          suggestion,
          suggestion_id: "00000000-0000-4000-8000-000000000001",
          confidence,
          reason: "Evidência sintética para revisão.",
        };
    const rows = saved && state === "pending" ? [] : [row];
    await route.fulfill({ json: { rows, total: rows.length } });
  });
  await page.route(
    "**/api" + base + "/transactions/" + original.id + "/identification",
    async (route) => {
      captured = route.request().postDataJSON();
      saved = true;
      await route.fulfill({ json: { saved: true } });
    },
  );
  await page.route("**/api" + base + "/recognition/run", async (route) => {
    assert.equal(route.request().postDataJSON().transaction_id, original.id);
    confidence = "MEDIUM";
    await route.fulfill({
      json: {
        updated_suggestions: [
          {
            transaction_id: original.id,
            suggestion_id: "00000000-0000-4000-8000-000000000002",
            suggestion: {
              ...suggestion,
              field_confidence: {
                party_id: "MEDIUM",
                category_id: "HIGH",
                subcategory_id: "HIGH",
                cost_center_id: "MEDIUM",
              },
            },
            confidence,
            reason: "Evidência atualizada sintética.",
          },
        ],
      },
    });
  });
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate(
    (id) => localStorage.setItem("autovisao.organization", id),
    org.id,
  );
  await page.reload();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "Transações", exact: true }).click();
  await page.getByRole("button", { name: /Identificar movimento/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Identificar Movimento",
    exact: true,
  });
  assert.equal(await dialog.locator(".ai-field-high").count(), 4);
  assert.equal(await dialog.locator(".ai-field-review").count(), 0);
  assert.ok(
    await dialog
      .getByLabel("Cliente / Fornecedor (opcional)", { exact: true })
      .getAttribute("aria-description"),
  );
  await dialog.getByText("Azul · Alta confiança", { exact: true }).waitFor();
  await dialog.getByText("Amarelo · Revisar", { exact: true }).waitFor();
  await page.screenshot({
    path: "import-layout-ai-fields-high.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Reavaliar sugestão", exact: true })
    .click();
  await dialog
    .getByText("Evidência atualizada sintética.", { exact: true })
    .waitFor();
  assert.equal(await dialog.locator(".ai-field-high").count(), 2);
  assert.equal(await dialog.locator(".ai-field-review").count(), 2);
  assert.ok(
    (
      await dialog
        .locator("#identify-cost_center_id")
        .locator("..")
        .locator("..")
        .getAttribute("class")
    ).includes("ai-field-review"),
  );
  await page.screenshot({
    path: "import-layout-ai-fields-mixed.png",
    fullPage: true,
  });
  await dialog
    .getByLabel("Centro de Custos", { exact: true })
    .fill("Centro manual");
  await page
    .getByRole("option", { name: "Centro manual", exact: true })
    .click();
  assert.equal(await dialog.locator(".ai-field-high").count(), 2);
  await dialog
    .getByRole("button", { name: "Reavaliar sugestão", exact: true })
    .click();
  await dialog
    .getByText("Evidência atualizada sintética.", { exact: true })
    .waitFor();
  assert.equal(
    await dialog.getByLabel("Centro de Custos", { exact: true }).inputValue(),
    "Centro manual",
  );
  assert.equal(await dialog.locator(".ai-field-review").count(), 1);
  assert.equal(await dialog.locator(".ai-field-high").count(), 2);
  await page.screenshot({
    path: "import-layout-ai-fields-review.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Salvar e fechar", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(captured.cost_center_id, manualCenter.id);
  await nav.getByRole("button", { name: "Histórico", exact: true }).click();
  await page.getByRole("button", { name: /Identificar movimento/ }).click();
  const reviewed = page.getByRole("dialog", {
    name: "Revisar Identificação",
    exact: true,
  });
  assert.equal(
    await reviewed
      .locator(".ai-field-high,.ai-field-review,.ai-field-badge")
      .count(),
    0,
  );
  await page.screenshot({
    path: "import-layout-ai-fields-confirmed.png",
    fullPage: true,
  });
} catch (error) {
  await page.screenshot({
    path: "import-layout-ai-fields-error.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
