import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173");
  assert.equal(await page.title(), "Finare | Cadastros");
  await page.getByText("Finare", { exact: true }).waitFor();
  await page.getByLabel("Nome da organização").fill("Organização sintética");
  await page.getByRole("button", { name: "Criar organização" }).click();

  async function open(name) {
    await page.getByRole("navigation").getByRole("button", { name }).click();
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
  }

  await page
    .getByRole("heading", { name: "Contas Bancárias", level: 1 })
    .waitFor();
  await fill({
    "Nome da conta": "Conta sintética",
    Agência: "0000",
    "Conta mascarada": "**1234",
  });
  await page.getByLabel("Banco", { exact: true }).fill("brasil");
  await page.getByRole("option", { name: "001 — BCO DO BRASIL S.A.", exact: true }).click();
  await page.getByLabel("Moeda", { exact: true }).fill("brasileiro");
  await page.getByRole("option", { name: "BRL — Real brasileiro", exact: true }).click();
  await save();
  await page.getByRole("row", { name: /Conta sintética CTA-\d+/ }).waitFor();
  await page.getByRole("button", { name: "Editar Conta sintética" }).click();
  await page.getByRole("switch", { name: "Cadastro ativo" }).click();
  await save();
  await page.getByLabel("Filtrar por situação").selectOption("active");
  await page.getByText("Nenhum resultado").waitFor();

  const menu = page.getByRole("navigation", { name: "Menu principal" });
  const group = menu.getByText("Cadastros", { exact: true });
  const menuItems = menu.locator(".nav-items").getByRole("button");
  await group.click();
  assert.equal(await menuItems.count(), 0);
  await group.click();
  assert.equal(await menuItems.count(), 4);

  await open("Classificações");
  assert.equal(
    await page.getByRole("navigation").getByText("Subclasses").count(),
    0,
  );
  await fill({ Nome: "Receitas de teste" });
  await page.getByLabel("Natureza", { exact: true }).selectOption("REVENUE");
  await save();
  await page
    .getByRole("button", { name: "Receitas de teste", exact: true })
    .click();
  const sub = page.getByRole("region", {
    name: "Subclassificações de Receitas de teste",
  });
  await sub.getByRole("button", { name: "+ Nova subclassificação" }).click();
  await sub.getByLabel("Código", { exact: true }).fill("servicos");
  await sub.getByLabel("Nome", { exact: true }).fill("Serviços sintéticos");
  await sub.getByRole("button", { name: "Salvar cadastro" }).click();
  await sub.getByRole("row", { name: /Serviços sintéticos/ }).waitFor();
  await page.reload();
  await open("Classificações");
  await page
    .getByRole("button", { name: "Receitas de teste", exact: true })
    .click();
  await sub.getByRole("row", { name: /Serviços sintéticos/ }).waitFor();

  await open("Centro de Custos");
  await fill({ Nome: "Sede de teste" });
  await save();
  await fill({ Nome: "Unidade de teste" });
  const parents = page.getByLabel("Centro superior", { exact: true });
  const parent = await parents
    .getByRole("option", { name: /CC-\d+ · Sede de teste/ })
    .getAttribute("value");
  await parents.selectOption(parent);
  await save();

  await open("Clientes e Fornecedores");
  await fill({ Nome: "Fornecedor sintético", "E-mail": "teste@example.test" });
  await page.getByLabel("Tipo", { exact: true }).selectOption("SUPPLIER");
  await save();

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
