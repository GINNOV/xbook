import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { embeddingContentHash } from "../../src/lib/embedding-index";
const databaseUrl = process.env.XBOOK_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing disposable E2E database");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
test.beforeAll(async () => {
  const model = "h1-fixture-model"; const endpoint = "http://127.0.0.1:1/v1";
  await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default", llmEmbeddingModel: model, llmEmbeddingBaseUrl: endpoint }, update: { llmEmbeddingModel: model, llmEmbeddingBaseUrl: endpoint } });
  const content = { summary: "Dashboard vector fixture", category: "H1", tags: "dashboard" };
  const current = { ...content, embedding: Buffer.from(new Float32Array([1, 0]).buffer), embeddingModel: model, embeddingEndpoint: endpoint, embeddingDimensions: 2, embeddingContentHash: embeddingContentHash(content), embeddingIndexedAt: new Date() };
  for (const row of [{ id: "h1-current", ...current }, { id: "h1-stale", ...current, summary: "Changed fixture" }, { id: "h1-missing", summary: "Missing fixture" }, { id: "h1-pending", summary: null }, { id: "h1-failed", summary: null, enrichmentError: "Fixture failure" }]) {
    await prisma.bookmark.upsert({ where: { id: row.id }, create: { ...row, source: "yt", tweetUrl: `https://youtube.com/watch?v=${row.id}` }, update: row });
  }
  await prisma.operationRun.createMany({ data: [{ id: "h1-yt-import", source: "yt", type: "youtube_sync", status: "completed", processed: 1, startedAt: new Date("2026-09-30T08:00:00Z"), finishedAt: new Date("2026-09-30T08:00:00Z") }, { id: "h1-x-import", source: "x", type: "x_sync", status: "completed", processed: 1, startedAt: new Date("2026-10-01T08:00:00Z"), finishedAt: new Date("2026-10-01T08:00:00Z") }] });
});
test.afterAll(async () => { await prisma.bookmark.deleteMany({ where: { id: { startsWith: "h1-" } } }); await prisma.operationRun.deleteMany({ where: { id: { startsWith: "h1-" } } }); await prisma.$disconnect(); });
test("dashboard coverage includes every saved entry and metric links open matching source/state", async ({ page, request }) => {
  await page.goto("/?tab=yt");
  const total = await prisma.bookmark.count({ where: { source: "yt" } });
  await expect(page.getByText(`${Math.round(100 / total)}% (1/${total}) of saved items have usable vectors`, { exact: true })).toBeVisible();
  await expect(page.getByText("This local entry cap does not measure YouTube API quota.")).toBeVisible();
  await expect(page.getByText(/Last YouTube import activity:/)).toContainText("9/30/2026");
  for (const state of ["unindexed", "stale", "failed", "pending"]) {
    const link = page.locator(`a[href="/bookmarks?source=yt&status=${state}"]`).first();
    await link.click(); await expect(page).toHaveURL(new RegExp(`source=yt&status=${state}`));
    await expect(page.getByRole("heading", { name: "YouTube Library" })).toBeVisible();
    await page.goto("/?tab=yt");
  }
  const response = await request.get("/api/version"); const identity = await response.json();
  expect(response.ok()).toBe(true); expect(identity.backend.pid).toBeGreaterThan(0); expect(identity.backend.port).toBe("3100");
  await expect(page.getByTestId("app-version")).toContainText(`PID ${identity.backend.pid}`);
  await page.screenshot({ path: "docs/repair-evidence/h1-dashboard-health.png", fullPage: true });
});
