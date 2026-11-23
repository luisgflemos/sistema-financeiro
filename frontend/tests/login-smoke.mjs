import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ baseURL: "http://localhost:5273" });
  await page.goto("/");
  await page.getByRole("heading", { name: "Entrar na Finare" }).waitFor();
  assert.equal((await page.request.get("/api/organizations")).status(), 401);
  await page.getByLabel("Usuário", { exact: true }).fill("teste");
  await page.getByLabel("Senha", { exact: true }).fill("incorreta");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByText("Usuário ou senha incorretos.").waitFor();
  await page.getByLabel("Senha", { exact: true }).fill("Teste8ok");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("heading", { name: "Organizações" }).waitFor();
  assert.deepEqual(
    await (await page.request.get("/api/organizations")).json(),
    [],
  );
  await page.reload();
  await page.getByRole("heading", { name: "Organizações" }).waitFor();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.getByRole("heading", { name: "Entrar na Finare" }).waitFor();
  assert.equal((await page.request.get("/api/organizations")).status(), 401);
} finally {
  await browser.close();
}
