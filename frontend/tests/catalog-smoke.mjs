import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173");
  assert.equal(await page.title(), "Finare | Cadastros");
  await page.getByText("Finare", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Nova organização", exact: true })
    .click();
  await page.getByLabel("Nome da organização").fill("Organização sintética");
  await page.getByRole("button", { name: "Criar organização" }).click();

  async function open(name) {
    const group = page
      .getByRole("navigation")
      .getByRole("button", { name: "Cadastros", exact: true });
    if ((await group.getAttribute("aria-expanded")) !== "true")
      await group.click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByRole("heading", { name, level: 1 }).waitFor();
  }

  async function fill(values) {
    for (const [label, value] of Object.entries(values)) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }
  }

  async function save() {
    await page.getByRole("button", { name: "Salvar cadastro" }).click();
    await page.getByText("Cadastro salvo.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
  }

  await page
    .getByRole("heading", { name: "Contas Bancárias", level: 1 })
    .waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page
    .getByRole("button", { name: "Novo cadastro", exact: true })
    .click();
  await fill({
    "Nome da conta": "Conta sintética",
    Agência: "0000",
    "Número da conta": "12345678",
    "CPF/CNPJ do titular": "12.345.678/0001-00",
  });
  await page.getByLabel("Banco", { exact: true }).fill("brasil");
  await page
    .getByRole("option", { name: "001 — BCO DO BRASIL S.A.", exact: true })
    .click();
  await page.getByLabel("Moeda", { exact: true }).fill("brasileiro");
  await page
    .getByRole("option", { name: "BRL — Real brasileiro", exact: true })
    .click();
  await save();
  await page.getByRole("row", { name: /Conta sintética CTA-\d+/ }).waitFor();
  const bankSearchX = (
    await page
      .getByRole("searchbox", { name: "Pesquisar cadastros" })
      .boundingBox()
  ).x;
  await page
    .getByRole("searchbox", { name: "Pesquisar cadastros" })
    .fill("BRASIL");
  await page.getByRole("row", { name: /Conta sintética CTA-\d+/ }).waitFor();
  await page
    .getByRole("searchbox", { name: "Pesquisar cadastros" })
    .fill("sem-correspondencia");
  await page.getByText("Nenhum resultado", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Limpar pesquisa" }).click();
  await page.getByRole("button", { name: "Editar Conta sintética" }).click();
  await page.getByRole("switch", { name: "Cadastro ativo" }).click();
  await save();
  await page.getByLabel("Filtrar por situação").fill("Ativos");
  await page.getByRole("option", { name: "Ativos", exact: true }).click();
  await page.getByText("Nenhum resultado").waitFor();

  const menu = page.getByRole("navigation", { name: "Menu principal" });
  assert.equal(await menu.getByRole("button").count(), 6);
  assert.equal(await page.getByRole("tablist").count(), 0);
  assert.equal(
    await page
      .getByLabel("Organização", { exact: true })
      .locator("..")
      .locator(".search-select-chevron")
      .count(),
    1,
  );

  const organization = page.getByLabel("Organização", { exact: true });
  await organization.click();
  await page.getByRole("listbox").waitFor();
  await organization.press("Escape");
  await organization.click();
  await page.getByRole("listbox").waitFor();
  await organization.press("Escape");
  await open("Classificações");
  await page.locator(".catalog-toolbar").waitFor();
  const treeSearchX = (
    await page
      .getByRole("searchbox", { name: "Pesquisar cadastros" })
      .boundingBox()
  ).x;
  assert.equal(
    treeSearchX,
    bankSearchX,
    "A busca deve começar na mesma posição nos cadastros",
  );
  const toolbarBounds = await page.locator(".catalog-toolbar").boundingBox();
  assert.ok(
    toolbarBounds.height < 90,
    "O cabeçalho deve permanecer compacto em desktop",
  );
  const searchBounds = await page
    .getByRole("searchbox", { name: "Pesquisar cadastros" })
    .boundingBox();
  const filterBounds = await page
    .getByLabel("Filtrar por situação")
    .boundingBox();
  assert.equal(
    searchBounds.y,
    filterBounds.y,
    "Busca e filtro devem estar na mesma linha",
  );
  await page.screenshot({
    path: "import-layout-compact-header.png",
    fullPage: true,
  });
  assert.equal(
    await page.getByRole("navigation").getByText("Subclasses").count(),
    0,
  );
  await page
    .getByRole("button", { name: "Nova classificação", exact: true })
    .click();
  await fill({ Nome: "Receitas de teste" });
  await page.getByLabel("Natureza", { exact: true }).fill("Receita");
  await page.getByRole("option", { name: "Receita", exact: true }).click();
  await save();
  await page.getByRole("button", { name: /^Receitas de teste/ }).click();
  const sub = page.getByRole("region", {
    name: "Classificações e subclassificações",
  });
  await page
    .getByRole("button", { name: "Nova subclassificação em Receitas de teste" })
    .click();
  assert.equal(
    await page.getByLabel("Código", { exact: true }).getAttribute("readonly"),
    "",
  );
  await page.getByLabel("Nome", { exact: true }).fill("Serviços sintéticos");
  await page.getByRole("button", { name: "Salvar cadastro" }).click();
  await sub.getByRole("row", { name: /Serviços sintéticos/ }).waitFor();
  await page.reload();
  await open("Classificações");
  await page.getByRole("button", { name: /^Receitas de teste/ }).click();
  await sub.getByRole("row", { name: /Serviços sintéticos/ }).waitFor();

  await page
    .getByRole("button", { name: "Recolher tudo", exact: true })
    .click();
  assert.equal(
    await sub.getByRole("row", { name: /Serviços sintéticos/ }).count(),
    0,
  );
  await page
    .getByRole("searchbox", { name: "Pesquisar cadastros" })
    .fill("SERVICOS SINTETICOS");
  await sub.getByRole("row", { name: /Serviços sintéticos/ }).waitFor();
  await sub.getByRole("button", { name: /^Receitas de teste/ }).waitFor();
  await page.getByRole("button", { name: "Limpar pesquisa" }).click();
  await page
    .getByRole("button", { name: "Expandir tudo", exact: true })
    .click();
  await sub.getByRole("row", { name: /Serviços sintéticos/ }).waitFor();

  await open("Centro de Custos");
  await page
    .getByRole("button", { name: "Novo cadastro", exact: true })
    .click();
  await fill({ Nome: "Sede de teste" });
  await save();
  await page
    .getByRole("button", { name: "Novo cadastro", exact: true })
    .click();
  await fill({ Nome: "Unidade de teste" });
  const parents = page.getByLabel("Centro superior", { exact: true });
  await parents.fill("Sede de teste");
  await page.getByRole("option", { name: /CC-\d+ · Sede de teste/ }).click();
  await save();

  await page
    .getByRole("searchbox", { name: "Pesquisar cadastros" })
    .fill("unidade");
  await page.getByRole("row", { name: /Unidade de teste/ }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Editar Sede de teste", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Limpar pesquisa" }).click();

  await open("Clientes e Fornecedores");
  await page
    .getByRole("button", { name: "Novo cadastro", exact: true })
    .click();
  await fill({
    "Nome do Cliente": "Fornecedor sintético",
    "E-mail": "teste@example.test",
  });
  await page.getByLabel("Tipo", { exact: true }).fill("Fornecedor");
  await page.getByRole("option", { name: "Fornecedor", exact: true }).click();
  await save();

  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await page.screenshot({ path: "import-layout-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "import-layout-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel("Arquivo CSV ou XLSX").setInputFiles({
    name: "clientes-erp.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "NOME FANTASIA;RESPONSÁVEL FINANCEIRO;TEL. COMERCIAL;TEL. CELULAR FINANCEIRO;E-MAIL;CPF\nCliente ERP sintético;Pessoa sintética;(11) 0000-0000;(11) 90000-0000;erp@example.test;000.000.000-00\n",
    ),
  });
  await page.getByRole("heading", { name: "Associar colunas" }).waitFor();
  const nameBox = page.getByLabel("Nome do Cliente *", { exact: true });
  assert.equal(await nameBox.inputValue(), "1 · NOME FANTASIA");
  assert.equal(
    await page.getByLabel("Contato", { exact: true }).inputValue(),
    "2 · RESPONSÁVEL FINANCEIRO",
  );
  await page
    .getByText("Identificação inteligente das colunas", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Validar importação", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByRole("button", { name: "Confirmar sugestões", exact: true })
    .click();
  const beforeOpen = await nameBox.boundingBox();
  await page.getByLabel("Tipo *", { exact: true }).click();
  const afterOpen = await nameBox.boundingBox();
  assert.deepEqual(
    afterOpen,
    beforeOpen,
    "Abrir a lista não deve deslocar os campos",
  );
  assert.equal(
    await page
      .getByRole("listbox")
      .evaluate((element) => getComputedStyle(element).position),
    "absolute",
  );
  await page.getByLabel("Tipo *", { exact: true }).fill("valor fixo");
  await page
    .getByRole("option", { name: "Importar com valor fixo", exact: true })
    .click();
  await page.getByLabel("Ativo", { exact: true }).fill("valor fixo");
  await page
    .getByRole("option", { name: "Importar com valor fixo", exact: true })
    .click();
  await page.getByText("Precisa da sua escolha", { exact: true }).waitFor();
  await page.getByLabel("Telefone", { exact: true }).fill("TEL. COMERCIAL");
  await page
    .getByRole("option", { name: "3 · TEL. COMERCIAL", exact: true })
    .click();
  await page.screenshot({ path: "import-layout-mapping.png", fullPage: true });
  await page
    .getByRole("button", { name: "Validar importação", exact: true })
    .click();
  await page.getByText(/Validação concluída/).waitFor();
  await page.getByText("Tipo: Cliente", { exact: true }).waitFor();
  await page.getByText("Ativo: Sim", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Confirmar importação", exact: true })
    .click();
  await page.getByText(/Importação concluída/).waitFor();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.getByRole("row", { name: /Cliente ERP sintético/ }).waitFor();
  await page
    .getByRole("searchbox", { name: "Pesquisar cadastros" })
    .fill("ERP SINTETICO");
  await page.screenshot({ path: "import-layout-search.png", fullPage: true });
  await page.getByRole("row", { name: /Cliente ERP sintético/ }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Editar Fornecedor sintético", exact: true })
      .count(),
    0,
  );
  await page.getByLabel("Filtrar por situação").fill("Inativos");
  await page.getByRole("option", { name: "Inativos", exact: true }).click();
  await page.getByText("Nenhum resultado", { exact: true }).waitFor();
  await page.getByLabel("Filtrar por situação").fill("Todas");
  await page
    .getByRole("option", { name: "Todas as situações", exact: true })
    .click();
  await page.getByRole("button", { name: "Limpar pesquisa" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await open("Clientes e Fornecedores");
  await page.getByRole("row", { name: /Fornecedor sintético/ }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "A página deve caber na largura de um celular",
  );
} finally {
  await browser.close();
}
