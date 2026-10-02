import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const databaseUrl = process.env.XBOOK_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing disposable E2E database");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
let previousEmbedding: { llmEmbeddingModel: string | null; llmEmbeddingBaseUrl: string | null } | null;

const parameters = new URLSearchParams({
  source: "x", category: "R2 models", folderId: "r2-search-folder", status: "summarized",
  video: "true", q: "nomic", sort: "author", dir: "asc",
});

const matching = "R2 exact word result";
const substring = "R2 substring result";

test.beforeAll(async () => {
  previousEmbedding = await prisma.settings.findUnique({
    where: { id: "default" }, select: { llmEmbeddingModel: true, llmEmbeddingBaseUrl: true },
  });
  await prisma.settings.upsert({
    where: { id: "default" },
    update: { llmEmbeddingModel: "e2e-unavailable", llmEmbeddingBaseUrl: "http://127.0.0.1:1/v1" },
    create: { id: "default", llmEmbeddingModel: "e2e-unavailable", llmEmbeddingBaseUrl: "http://127.0.0.1:1/v1" },
  });
  await prisma.bookmarkFolder.create({ data: { id: "r2-search-folder", name: "R2 search fixture" } });
  await prisma.bookmark.createMany({ data: [
    { id: "r2-search-exact", text: "Nomic embedding model", summary: matching, category: "R2 models" },
    { id: "r2-search-substring", text: "Economic embedding model", summary: substring, category: "R2 models" },
    { id: "r2-search-excluded", text: "Nomic embedding model", summary: "R2 excluded category", category: "Other R2" },
  ].map((row) => ({ ...row, source: "x", tweetUrl: `https://example.com/${row.id}`,
    folderId: "r2-search-folder", externalUrls: "https://youtu.be/r2-example" })) });
});

test.afterAll(async () => {
  await prisma.bookmark.deleteMany({ where: { id: { startsWith: "r2-search-" } } });
  await prisma.bookmarkFolder.delete({ where: { id: "r2-search-folder" } });
  await prisma.settings.update({ where: { id: "default" }, data: previousEmbedding ?? { llmEmbeddingModel: null, llmEmbeddingBaseUrl: null } });
  await prisma.$disconnect();
});

test("exact word and phrase controls preserve scope and explicit sort", async ({ page }) => {
  await page.goto(`/bookmarks?${parameters}`);
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${matching}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${substring}`) })).toBeVisible();

  await page.getByLabel("Text matching").selectOption("word");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/textMode=word/);
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${matching}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${substring}`) })).toHaveCount(0);
  await expect(page.getByLabel("Category")).toHaveValue("R2 models");
  await expect(page.getByLabel("Folder", { exact: true })).toHaveValue("r2-search-folder");
  const current = new URL(page.url()).searchParams;
  expect(current.get("sort")).toBe("author");
  expect(current.get("dir")).toBe("asc");
  expect(current.get("video")).toBe("true");
  expect(current.get("status")).toBe("summarized");

  await page.getByLabel("Text matching").selectOption("phrase");
  await page.getByLabel("Search bookmarks").fill("embedding nomic");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=embedding(?:%20|\+)nomic/);
  await expect(page.getByText("No bookmarks match the current filters.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Search bookmarks")).toHaveValue("embedding nomic");
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${matching}`) })).toHaveCount(0);
  await page.getByLabel("Search bookmarks").fill("nomic embedding");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${matching}`) })).toBeVisible();
  await expect(page).toHaveURL(/q=nomic(?:%20|\+)embedding/);
  await expect(page.getByLabel("Search bookmarks")).toHaveValue("nomic embedding");
  await page.screenshot({ path: "docs/repair-evidence/r2-exact-search.png", fullPage: true });
});

test("unavailable embeddings keeps scoped exact results and a Settings recovery link", async ({ page }) => {
  await page.goto(`/bookmarks?${parameters}&semantic=true&textMode=word`);
  const fallback = page.getByRole("status").filter({ hasText: "Semantic search is unavailable" });
  await expect(fallback).toBeVisible();
  await expect(fallback.getByRole("link", { name: /embedding model in Settings/ })).toHaveAttribute("href", "/settings");
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${matching}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Read bookmark: ${substring}`) })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Read bookmark: R2 excluded category/ })).toHaveCount(0);
  await expect(page.getByLabel("Text matching")).toHaveValue("word");
  await expect(page.getByLabel("Category")).toHaveValue("R2 models");
  await expect(page.getByLabel("Folder", { exact: true })).toHaveValue("r2-search-folder");
  await page.screenshot({ path: "docs/repair-evidence/r2-semantic-fallback.png", fullPage: true });
});
