import assert from "node:assert/strict";
import { chromium } from "playwright";

const endpoint = "http://127.0.0.1:8000";
async function api(path, body) {
  const result = await fetch(
    endpoint + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  assert.ok(result.ok, await result.clone().text());
  return result.json();
}
const org = await api("/organizations", { name: "Transações sintéticas" });
const base = "/organizations/" + org.id;
await api(base + "/bank-accounts", {
  label: "Conta de extrato sintético",
  bank_code: "033",
  branch: "0001",
  account_number: "12345",
  account_digit: "6",
  active: true,
  currency: "BRL",
});
const category = await api(base + "/categories", {
  name: "Receitas sintéticas",
  kind: "REVENUE",
});
await api(base + "/subcategories", {
  name: "Serviços sintéticos",
  category_id: category.id,
});
await api(base + "/cost-centers", { name: "Centro sintético" });
await api(base + "/parties", {
  display_name: "Cliente sintético",
  type: "CUSTOMER",
});
const csv =
  "AGENCIA;0001;CONTA;123456\n;;;;\nData;Histórico;Documento;Valor (R$);Saldo (R$)\n02/01/2026;PIX CLIENTE SINTETICO;0001;100;150\n01/01/2026;TARIFA SINTETICA;0001;-10;50\n";

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
    .getByRole("heading", { name: "Transações", exact: true, level: 1 })
    .waitFor();
  await page
    .getByRole("button", { name: "Importar Extratos", exact: true })
    .click();
  await page.getByLabel("Arquivos de extrato", { exact: true }).setInputFiles({
    name: "sintetico.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page
    .getByText("Conta identificada pelo cabeçalho", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "import-layout-statement-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Importar e identificar", exact: true })
    .click();
  await page.getByText("PIX CLIENTE SINTETICO", { exact: true }).waitFor();
  await page.screenshot({
    path: "import-layout-transactions.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Importar Extratos", exact: true })
    .click();
  await page.getByLabel("Arquivos de extrato", { exact: true }).setInputFiles({
    name: "sobreposto.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv + "\n"),
  });
  await page
    .getByText("2 já existentes — identificados automaticamente.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Importar e identificar", exact: true })
    .click();
  await page
    .getByText(
      "Nenhum movimento novo. Os registros existentes foram preservados.",
      { exact: true },
    )
    .waitFor();
  await page.getByText("PIX CLIENTE SINTETICO", { exact: true }).waitFor();
  const row = page
    .getByRole("row")
    .filter({ hasText: "PIX CLIENTE SINTETICO" });
  await row.getByRole("button", { name: /Identificar movimento/ }).click();
  await page
    .getByRole("button", { name: "← Voltar à visão geral", exact: true })
    .click();
  await row.getByRole("button", { name: /Identificar movimento/ }).click();
  for (const [label, value] of [
    ["Classificação", "Receitas sintéticas"],
    ["Subclassificação", "Serviços sintéticos"],
    ["Centro de Custos", "Centro sintético"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("option", { name: value, exact: true }).click();
  }
  await page
    .getByLabel("Descrição Complementar", { exact: true })
    .fill("Detalhe sintético para revisão.");
  let chatCalls = 0;
  await page.route("**/assistant/chat", async (route) => {
    const data = route.request().postDataJSON();
    assert.ok(data.transaction_id);
    assert.equal(data.messages.at(-1).role, "user");
    if (chatCalls) assert.equal(data.messages.at(-2).role, "assistant");
    chatCalls++;
    await route.fulfill({
      json: {
        answer: "Orientação sintética: revise os campos antes de salvar.",
      },
    });
  });
  await page
    .getByRole("button", {
      name: "Conversar sobre este lançamento",
      exact: true,
    })
    .click();
  const chat = page.getByRole("region", {
    name: "Conversa com Assistente Finare",
    exact: true,
  });
  await chat
    .getByLabel("Sua mensagem", { exact: true })
    .fill("Por que esta sugestão?");
  await chat.getByRole("button", { name: "Enviar", exact: true }).click();
  await chat
    .getByText("Orientação sintética: revise os campos antes de salvar.", {
      exact: true,
    })
    .waitFor();
  await chat
    .getByLabel("Sua mensagem", { exact: true })
    .fill("Qual o próximo passo?");
  await chat.getByRole("button", { name: "Enviar", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".assistant-message-assistant").length === 2,
  );
  assert.equal(chatCalls, 2);
  await page.screenshot({
    path: "import-layout-assistant-detail.png",
    fullPage: true,
  });
  await chat
    .getByRole("button", { name: "Minimizar assistente", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Descrição Complementar", { exact: true })
      .inputValue(),
    "Detalhe sintético para revisão.",
  );
  await page
    .getByRole("button", { name: "Salvar e próximo", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("TARIFA SINTETICA", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("dialog").evaluate((element) => element.scrollTop),
    0,
    "O próximo lançamento deve abrir com os dados originais visíveis no topo",
  );
  await page.screenshot({
    path: "import-layout-transaction-detail.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ver extrato completo", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "PIX CLIENTE SINTETICO" })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transações", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Transações", level: 1, exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "import-layout-transactions-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Conversar com Assistente Finare",
      exact: true,
    })
    .click();
  await page.getByLabel("Sua mensagem", { exact: true }).fill("Como começar?");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "import-layout-assistant-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Minimizar assistente", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Contas Bancárias", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Conversar com Assistente Finare",
      exact: true,
    })
    .click();
  assert.equal(
    await page.getByLabel("Sua mensagem", { exact: true }).inputValue(),
    "Como começar?",
  );
} finally {
  await browser.close();
}
