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
    .getByRole("heading", { name: "Contas bancárias", level: 1 })
    .waitFor();
  await fill({
    Código: "conta-01",
    Titular: "Titular sintético",
    "Código do banco": "000",
    Agência: "0000",
    "Conta mascarada": "**1234",
  });
  await save();
  await page.getByRole("row", { name: /Titular sintético/ }).waitFor();
  await page.getByRole("button", { name: "Editar Titular sintético" }).click();
  await page.getByRole("checkbox", { name: "Cadastro ativo" }).uncheck();
  await save();
  await page.getByLabel("Filtrar por situação").selectOption("active");
  await page.getByText("Nenhum resultado").waitFor();

  await open("Subclasses");
  await page.getByRole("button", { name: "Abrir classificações" }).click();
  await fill({ Código: "receitas", Nome: "Receitas de teste" });
  await page.getByLabel("Natureza", { exact: true }).selectOption("REVENUE");
  await save();
  await open("Subclasses");
  await page
    .getByLabel("Classificação", { exact: true })
    .selectOption({ label: "receitas · Receitas de teste" });
  await fill({ Código: "servicos", Nome: "Serviços sintéticos" });
  await save();

  await open("Centros de custos");
  await fill({ Código: "sede", Nome: "Sede de teste" });
  await save();
  await fill({ Código: "unidade", Nome: "Unidade de teste" });
  await page
    .getByLabel("Centro superior", { exact: true })
    .selectOption({ label: "sede · Sede de teste" });
  await save();

  await open("Clientes e fornecedores");
  await fill({ Nome: "Fornecedor sintético", "E-mail": "teste@example.test" });
  await page.getByLabel("Tipo", { exact: true }).selectOption("SUPPLIER");
  await save();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await open("Clientes e fornecedores");
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
