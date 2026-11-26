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
const expenseCategory = await api(base + "/categories", {
  name: "Despesas sintéticas",
  kind: "EXPENSE",
});
const neutralCategory = await api(base + "/categories", {
  name: "Transferências sintéticas",
  kind: "NEUTRAL",
});
await api(base + "/subcategories", {
  name: "Entre contas sintéticas",
  category_id: neutralCategory.id,
});
await api(base + "/subcategories", {
  name: "Aluguel sintético",
  category_id: expenseCategory.id,
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
  await page
    .getByRole("button", { name: "Verificar duplicidades", exact: true })
    .click();
  await page.screenshot({
    path: "import-layout-statement-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Importar e identificar", exact: true })
    .click();
  await page.getByText("PIX CLIENTE SINTETICO", { exact: true }).waitFor();
  async function sortBy(label, field, order) {
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/transactions") &&
        url.searchParams.get("sort_by") === field &&
        url.searchParams.get("sort_order") === order
      );
    });
    await page
      .getByRole("button", {
        name: `Ordenar por ${label}: ${order === "asc" ? "crescente" : "decrescente"}`,
        exact: true,
      })
      .click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const result = await response.json();
    assert.equal(result.total, 2);
    const header = page.getByRole("columnheader").filter({
      has: page.getByRole("button", {
        name: new RegExp(`^Ordenar por ${label}:`),
      }),
    });
    assert.equal(
      await header.getAttribute("aria-sort"),
      order === "asc" ? "ascending" : "descending",
    );
    return result;
  }
  assert.equal(
    (await sortBy("Valor", "amount", "asc")).rows[0].direction,
    "DEBIT",
  );
  assert.equal(
    (await sortBy("Valor", "amount", "desc")).rows[0].direction,
    "CREDIT",
  );
  await page.screenshot({ path: "import-layout-sorting.png", fullPage: true });
  for (const [label, field] of [
    ["Conta", "account"],
    ["Histórico do Banco", "description"],
    ["Identificação", "identification"],
    ["Data", "date"],
  ]) {
    await sortBy(label, field, "asc");
    await sortBy(label, field, "desc");
  }
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
    .getByRole("button", { name: "Verificar duplicidades", exact: true })
    .click();
  await page
    .getByText("2 movimentos já existentes serão mantidos, sem duplicação.", {
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
    if (label === "Classificação") {
      await page.getByLabel(label, { exact: true }).click();
      assert.equal(
        await page
          .getByRole("option", { name: "Despesas sintéticas", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("option", {
            name: "Transferências sintéticas",
            exact: true,
          })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("option", { name: "Receitas sintéticas", exact: true })
          .count(),
        1,
      );
      await page.getByLabel(label, { exact: true }).press("Escape");
    }
    await page
      .getByLabel(label, { exact: true })
      .fill(label === "Centro de Custos" ? "sintetico Centro" : value);
    if (label === "Centro de Custos") {
      assert.equal(
        await page.getByRole("option").count(),
        1,
        "A busca deve aceitar palavras em outra ordem e sem acentos",
      );
      const box = await page.getByLabel(label, { exact: true }).boundingBox();
      const complementary = await page
        .getByLabel("Descrição Complementar", { exact: true })
        .boundingBox();
      assert.ok(
        Math.abs(box.y - complementary.y) <= 2,
        "Os campos da mesma linha devem alinhar pelo topo",
      );
      const list = await page.getByRole("listbox").boundingBox();
      const modal = await page.getByRole("dialog").boundingBox();
      assert.ok(
        list.y >= modal.y && list.y + list.height <= modal.y + modal.height,
        "A lista deve ficar dentro da área visível do pop-up",
      );
      await page.screenshot({
        path: "import-layout-cost-center-search.png",
        fullPage: true,
      });
    }
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
    await page
      .getByLabel("Tratamento do movimento", { exact: true })
      .inputValue(),
    "Despesa",
  );
  assert.equal(
    await page.getByRole("dialog").evaluate((element) => element.scrollTop),
    0,
    "O próximo lançamento deve abrir com os dados originais visíveis no topo",
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  const dialogSize = await page.getByRole("dialog").evaluate((element) => ({
    scroll: element.scrollHeight,
    visible: element.clientHeight,
  }));
  assert.ok(
    dialogSize.scroll <= dialogSize.visible + 1,
    "O formulário direto deve caber inteiro em uma janela desktop de 720px: " +
      JSON.stringify(dialogSize),
  );
  await page.screenshot({
    path: "import-layout-transaction-detail.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByLabel("Classificação", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("option", { name: "Receitas sintéticas", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("option", { name: "Despesas sintéticas", exact: true })
      .count(),
    1,
  );
  await page.getByLabel("Classificação", { exact: true }).press("Escape");
  await page
    .getByLabel("Tratamento do movimento", { exact: true })
    .fill("Transferência");
  await page
    .getByRole("option", {
      name: "Transferência entre contas próprias",
      exact: true,
    })
    .click();
  await page.getByLabel("Classificação", { exact: true }).click();
  assert.equal(
    await page
      .getByRole("option", { name: "Despesas sintéticas", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("option", { name: "Receitas sintéticas", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("option", { name: "Transferências sintéticas", exact: true })
    .click();
  await page
    .getByLabel("Subclassificação", { exact: true })
    .fill("Entre contas");
  await page
    .getByRole("option", { name: "Entre contas sintéticas", exact: true })
    .click();
  await page
    .getByLabel("Tratamento do movimento", { exact: true })
    .fill("Despesa");
  await page.getByRole("option", { name: "Despesa", exact: true }).click();
  assert.equal(
    await page.getByLabel("Classificação", { exact: true }).inputValue(),
    "Selecione",
  );
  assert.equal(
    await page.getByLabel("Subclassificação", { exact: true }).inputValue(),
    "Selecione",
  );
  await page
    .getByRole("button", { name: "Ver extrato completo", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "PIX CLIENTE SINTETICO" })
    .waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Lançamentos", exact: true })
    .click();
  await page.getByRole("button", { name: "Nova Despesa", exact: true }).click();
  await page
    .getByLabel("Descrição", { exact: true })
    .fill("Aluguel previsto sintético");
  await page.getByLabel("Vencimento", { exact: true }).fill("2027-01-31");
  await page.getByLabel("Valor previsto (R$)", { exact: true }).fill("30,00");
  for (const [label, value] of [
    ["Classificação", "Despesas sintéticas"],
    ["Subclassificação", "Aluguel sintético"],
    ["Centro de Custos", "Centro sintético"],
    ["Recorrência", "Mensal"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("option", { name: value, exact: true }).click();
  }
  await page.getByLabel("Quantidade de ocorrências", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Criar 2 Lançamentos", exact: true })
    .click();
  await page.getByRole("row").filter({ hasText: "31/01/2027" }).waitFor();
  const recurrence = await api(base + "/planned-entries");
  assert.equal(recurrence.total, 2);
  assert.deepEqual(
    recurrence.rows.map((row) => row.due_on),
    ["2027-01-31", "2027-02-28"],
  );
  assert.equal(
    (await api(base + "/transactions?state=all")).total,
    2,
    "Previsões não criam movimentos bancários",
  );
  await page.screenshot({ path: "import-layout-planning.png", fullPage: true });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Importar Extrato", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "TARIFA SINTETICA" })
    .getByRole("button", { name: /Identificar movimento/ })
    .click();
  assert.equal(
    await page
      .getByLabel("Como identificar este movimento?", { exact: true })
      .count(),
    0,
  );
  const priorAction = page.getByRole("button", {
    name: "Identificar com Lançamento Prévio",
    exact: true,
  });
  const priorBounds = await priorAction.boundingBox();
  const headerBounds = await page
    .locator(".transaction-original")
    .boundingBox();
  assert.ok(
    Math.abs(
      priorBounds.x +
        priorBounds.width -
        (headerBounds.x + headerBounds.width - 13),
    ) < 3,
    "A ação deve estar alinhada à direita no cabeçalho",
  );
  const metadataBounds = await page
    .locator(".transaction-header-footer > small")
    .boundingBox();
  assert.ok(
    Math.abs(
      priorBounds.y +
        priorBounds.height / 2 -
        metadataBounds.y -
        metadataBounds.height / 2,
    ) < 3,
    "A ação deve compartilhar a linha dos dados de documento e saldo",
  );
  await priorAction.click();
  await page.getByLabel("Lançamento existente", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "← Voltar à Identificação Direta",
      exact: true,
    })
    .click();
  await page.getByLabel("Centro de Custos", { exact: true }).waitFor();
  await priorAction.click();
  await page
    .getByLabel("Lançamento existente", { exact: true })
    .fill("Aluguel previsto sintético");
  await page
    .getByRole("option", { name: /Aluguel previsto sintético.*31\/01\/2027/ })
    .click();
  await page
    .getByLabel("Descrição Complementar (opcional)", { exact: true })
    .fill("Baixa parcial sintética");
  await page.screenshot({
    path: "import-layout-planning-link.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Vincular e dar baixa", exact: true })
    .click();
  await page
    .getByText("Movimento vinculado e baixa registrada.", { exact: true })
    .waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Histórico", exact: true })
    .click();
  await page.getByText("Baixa parcial sintética", { exact: true }).waitFor();
  await page
    .getByText("Vinculado a: Aluguel previsto sintético", { exact: true })
    .waitFor();
  await page
    .getByRole("row")
    .filter({ hasText: "TARIFA SINTETICA" })
    .getByText("Identificado", { exact: true })
    .waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Lançamentos", exact: true })
    .click();
  const plannedRow = page.getByRole("row").filter({ hasText: "31/01/2027" });
  await plannedRow
    .getByText("Parcialmente realizado", { exact: true })
    .waitFor();
  const protectedExclusion = plannedRow.getByRole("button", {
    name: "Excluir",
    exact: true,
  });
  assert.equal(await protectedExclusion.isEnabled(), false);
  await protectedExclusion.locator("..").hover();
  await protectedExclusion.locator("..").getByRole("tooltip").waitFor();
  assert.ok(
    (
      await protectedExclusion.locator("..").getByRole("tooltip").innerText()
    ).includes("histórico de baixas"),
  );
  await plannedRow.getByRole("button", { name: "Baixas", exact: true }).click();
  await page
    .getByRole("button", { name: "Desvincular movimento", exact: true })
    .click();
  await page
    .getByText(
      "Vínculo desfeito. O saldo em aberto foi recalculado; o movimento bancário foi preservado.",
      { exact: true },
    )
    .waitFor();
  await plannedRow.getByText("Em aberto", { exact: true }).waitFor();
  assert.equal((await api(base + "/transactions?state=all")).total, 2);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Histórico", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "TARIFA SINTETICA" })
    .getByRole("button", { name: /Identificar movimento/ })
    .click();
  await page
    .getByLabel("Tratamento do movimento", { exact: true })
    .fill("Processos Automáticos");
  await page
    .getByRole("option", { name: "Processos Automáticos", exact: true })
    .click();
  for (const label of [
    "Classificação",
    "Subclassificação",
    "Centro de Custos",
    "Cliente / Fornecedor (opcional)",
  ])
    assert.equal(await page.getByLabel(label, { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("button", {
        name: "Identificar com Lançamento Prévio",
        exact: true,
      })
      .count(),
    0,
  );
  await page.screenshot({
    path: "import-layout-automatic-neutral.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Salvar e fechar", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "TARIFA SINTETICA" })
    .getByText("Processos Automáticos", { exact: true })
    .waitFor();
  const neutralMovement = (
    await api(base + "/transactions?state=all")
  ).rows.find((row) => row.raw_description === "TARIFA SINTETICA");
  assert.equal(neutralMovement.movement_kind, "AUTOMATIC_PROCESS");
  assert.equal(neutralMovement.amount, "10.00");
  for (const field of [
    "category_id",
    "subcategory_id",
    "cost_center_id",
    "party_id",
  ])
    assert.equal(neutralMovement[field], null);
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
  await page.screenshot({
    path: "import-layout-assistant-mobile.png",
    fullPage: true,
  });
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
    .getByRole("button", { name: "Cadastros", exact: true })
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
  await page
    .getByRole("button", { name: "Minimizar assistente", exact: true })
    .click();
  const fin = page.getByRole("button", {
    name: "Conversar com Assistente Finare",
    exact: true,
  });
  const initial = await fin.boundingBox();
  assert.ok(
    initial.width <= 64 && initial.height <= 68,
    "O acesso à Fin deve ser compacto",
  );
  const symbol = await fin.locator(".fin-symbol").boundingBox();
  const name = await fin.locator(".fin-launcher-name").boundingBox();
  assert.ok(
    name.y >= symbol.y + symbol.height,
    "O nome deve ficar abaixo do logo",
  );
  await page.mouse.move(
    initial.x + initial.width / 2,
    initial.y + initial.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(90, 430, { steps: 12 });
  await page.mouse.up();
  assert.equal(
    await page
      .getByRole("region", {
        name: "Conversa com Assistente Finare",
        exact: true,
      })
      .count(),
    0,
    "Arrastar não deve abrir a conversa",
  );
  const moved = await fin.boundingBox();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Reposicionar a Fin não deve criar rolagem horizontal na página",
  );
  assert.ok(
    Math.abs(moved.x - initial.x) > 100 && Math.abs(moved.y - initial.y) > 100,
    "A Fin deve mover-se nas duas direções",
  );
  await page.screenshot({
    path: "import-layout-fin-draggable.png",
    fullPage: true,
  });
  await page.reload();
  await fin.waitFor();
  const restored = await fin.boundingBox();
  assert.ok(
    Math.abs(restored.x - moved.x) < 2 && Math.abs(restored.y - moved.y) < 2,
    "A posição deve ser lembrada após recarregar",
  );
  await fin.click();
  await page
    .getByRole("region", {
      name: "Conversa com Assistente Finare",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Minimizar assistente", exact: true })
    .click();
  await fin.focus();
  await fin.press("Alt+ArrowRight");
  const keyboard = await fin.boundingBox();
  assert.ok(
    keyboard.x > restored.x,
    "O reposicionamento também deve funcionar por teclado",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  const resized = await fin.boundingBox();
  assert.ok(
    resized.x >= 0 &&
      resized.y >= 0 &&
      resized.x + resized.width <= 1280 &&
      resized.y + resized.height <= 800,
    "O botão deve permanecer visível ao redimensionar",
  );
} finally {
  await browser.close();
}
