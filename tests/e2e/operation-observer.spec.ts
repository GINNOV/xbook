import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const databaseUrl = process.env.XBOOK_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing disposable E2E database");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
let provider: Server;
let origin: string;
let available = true;
let chatCalls = 0;

test.beforeAll(async () => {
  provider = createServer(async (request, response) => {
    request.resume();
    response.setHeader("Content-Type", "application/json");
    if (request.url?.endsWith("/models")) {
      response.end(JSON.stringify({ object: "list", data: available ? [{ id: "observer-chat", object: "model" }] : [] }));
    } else if (request.url?.endsWith("/embeddings")) {
      response.end(JSON.stringify({ object: "list", data: [{ object: "embedding", index: 0, embedding: Buffer.from(new Float32Array([1, 0]).buffer).toString("base64") }], model: "observer-embed", usage: { prompt_tokens: 1, total_tokens: 1 } }));
    } else {
      chatCalls++;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      response.end(JSON.stringify({ id: "observer-response", object: "chat.completion", model: "observer-chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ summary: "Observer fixture summarized", category: "Observer", tags: ["fixture"] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Missing provider listener");
  origin = `http://127.0.0.1:${address.port}/v1`;
});

test.beforeEach(async () => {
  available = true; chatCalls = 0;
  await prisma.settings.upsert({ where: { id: "default" }, update: { llmBaseUrl: origin, llmModel: "observer-chat", llmEmbeddingBaseUrl: origin, llmEmbeddingModel: "observer-embed", llmConcurrency: 1 }, create: { id: "default", llmBaseUrl: origin, llmModel: "observer-chat", llmEmbeddingBaseUrl: origin, llmEmbeddingModel: "observer-embed", llmConcurrency: 1 } });
  await prisma.bookmark.createMany({ data: Array.from({ length: 6 }, (_, index) => ({ id: `r4-observer-${index}`, source: "x", tweetUrl: `https://example.com/r4-observer-${index}`, text: `Observer source ${index}` })) });
});
test.afterEach(async () => {
  const runs = await prisma.operationRun.findMany({ where: { jobJson: { contains: "r4-observer-" } }, select: { id: true } });
  await prisma.operationRun.updateMany({ where: { id: { in: runs.map((run) => run.id) } }, data: { status: "stopped", cancelRequestedAt: new Date(), leaseOwner: null, leaseUntil: null, revision: { increment: 1 } } });
  await prisma.operationRun.deleteMany({ where: { id: { in: runs.map((run) => run.id) } } });
  await prisma.bookmark.deleteMany({ where: { id: { startsWith: "r4-observer-" } } });
});
test.afterAll(async () => { provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve())); await prisma.$disconnect(); });

test("server continues across navigation; remount observes, stops and resumes the same operation", async ({ page }) => {
  const submissions: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/enrich?")) submissions.push(request.url()); });
  let disconnected = false;
  await page.route("**/api/processing/runs/*", async (route) => {
    if (route.request().method() === "GET" && !disconnected) { disconnected = true; await route.abort("internetdisconnected"); }
    else await route.continue();
  });
  await page.goto("/?source=x");
  await page.getByRole("button", { name: "Advanced actions" }).click();
  const submitted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/enrich?"));
  await page.getByRole("button", { name: /Enrich all X/ }).click();
  const acknowledgment = await submitted;
  expect(acknowledgment.status()).toBe(202);
  const { runId } = await acknowledgment.json();
  await expect(page.getByRole("alert").filter({ hasText: "Reconnecting automatically" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View operation" }).first()).toBeVisible();
  await page.goto("/bookmarks?source=x");
  await expect.poll(async () => (await prisma.operationRun.findUnique({ where: { id: runId } }))?.updated).toBeGreaterThan(0);
  await page.goto("/?source=x");
  await expect(page.getByRole("link", { name: "View operation" }).first()).toHaveAttribute("href", `/processing?runId=${runId}`);
  await page.getByRole("button", { name: "Stop operation", exact: true }).click();
  await expect.poll(async () => (await prisma.operationRun.findUnique({ where: { id: runId } }))?.status).toBe("stopped");
  const stopped = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  expect(stopped.updated).toBeLessThan(6);
  await expect(page.getByRole("button", { name: "Resume operation" })).toBeVisible();
  await page.screenshot({ path: "docs/repair-evidence/r4-stopped-observer.png", fullPage: true });
  await page.getByRole("button", { name: "Resume operation" }).click();
  await expect.poll(async () => (await prisma.operationRun.findUnique({ where: { id: runId } }))?.status, { timeout: 15000 }).toBe("completed");
  const completed = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  expect(completed.updated).toBe(6);
  expect(completed.processed).toBe(6);
  expect(submissions).toHaveLength(1);
  expect(chatCalls).toBeGreaterThanOrEqual(6);
});

test("failed model preflight has a repair link and resumes its frozen checkpoint", async ({ page }) => {
  available = false;
  await page.goto("/?source=x");
  await page.getByRole("button", { name: "Advanced actions" }).click();
  const submitted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/enrich?"));
  await page.getByRole("button", { name: /Enrich all X/ }).click();
  const { runId } = await (await submitted).json();
  await expect(page.getByRole("link", { name: "Repair settings" })).toHaveAttribute("href", "/settings?tab=ai");
  await expect(page.getByRole("button", { name: "Resume operation" })).toBeVisible();
  const failed = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  expect(failed.status).toBe("failed");
  expect(failed.processed).toBe(0);
  await page.screenshot({ path: "docs/repair-evidence/r4-provider-recovery.png", fullPage: true });
  available = true;
  await page.getByRole("button", { name: "Resume operation" }).click();
  await expect(page.getByRole("link", { name: "Repair settings" })).toHaveCount(0);
  await expect.poll(async () => (await prisma.operationRun.findUnique({ where: { id: runId } }))?.status, { timeout: 15000 }).toBe("completed");
  expect((await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } })).updated).toBe(6);
});
