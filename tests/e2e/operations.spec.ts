import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const databaseUrl = process.env.XBOOK_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing disposable E2E database");
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

test.describe("Operations & Logs", () => {
  test.beforeEach(async () => {
    await prisma.settings.upsert({
      where: { id: "default" },
      update: { llmModel: "e2e-model" },
      create: { id: "default", llmModel: "e2e-model" },
    });
    await prisma.operationRun.createMany({
      data: [
        { id: "999001", type: "enrichment_batch", source: "x", status: "running", startedAt: new Date() },
        { id: "999002", type: "enrichment_batch", source: "yt", status: "completed", startedAt: new Date(Date.now() - 3600000), finishedAt: new Date() },
      ]
    });

    await prisma.bookmark.upsert({
      where: { id: "e2e-operations-bookmark-x" },
      update: {
        source: "x",
        tweetUrl: "https://x.com/i/web/status/e2e-operations-bookmark-x",
        text: "E2E bookmark source text for UI validation.",
        authorUsername: "e2e_author",
        summary: null,
        category: null,
        tags: null,
      },
      create: {
        id: "e2e-operations-bookmark-x",
        source: "x",
        tweetUrl: "https://x.com/i/web/status/e2e-operations-bookmark-x",
        text: "E2E bookmark source text for UI validation.",
        authorUsername: "e2e_author",
      },
    });
  });

  test.afterEach(async () => {
    await prisma.operationRun.deleteMany({
      where: { id: { in: ["999001", "999002"] } }
    });
    await prisma.bookmark.deleteMany({
      where: { id: "e2e-operations-bookmark-x" }
    });
  });

  test("Source filtering works correctly", async ({ page }) => {
    await page.goto("/processing");
    
    // Check all visible initially
    await expect(page.getByText("enrichment batch").first()).toBeVisible();
    
    // Filter by X
    await page.getByRole("link", { name: "X", exact: true }).click();
    await page.waitForURL(/source=x/);
    await expect(page.url()).toContain("source=x");
    
    await expect(page.locator('a[href*="runId=999001"]')).toBeVisible();
    await expect(page.locator('a[href*="runId=999002"]')).toHaveCount(0);

    // Filter by YouTube
    await page.getByRole("link", { name: "YouTube", exact: true }).click();
    await page.waitForURL(/source=yt/);
    await expect(page.url()).toContain("source=yt");
    await expect(page.locator('a[href*="runId=999002"]')).toBeVisible();
    await expect(page.locator('a[href*="runId=999001"]')).toHaveCount(0);
  });

  test("Stop all operations button appears and works", async ({ page }) => {
    await page.goto("/processing");
    
    const stopAllBtn = page.getByRole("button", { name: "Stop all operations" });
    await expect(stopAllBtn).toBeVisible();
    
    await stopAllBtn.click();
    await page.getByRole("button", { name: "Stop All", exact: true }).click();
    
    // After stopping, wait for the status to update in the UI (lowercase stopped in the list)
    await expect(page.locator(".font-bold", { hasText: "stopped" }).first()).toBeVisible();
    
    const run = await prisma.operationRun.findUnique({ where: { id: "999001" } });
    expect(run?.status).toBe("stopped");
  });

  test("Clear all logs button works", async ({ page }) => {
    await prisma.operationRun.update({
      where: { id: "999001" },
      data: { status: "stopped" },
    });

    await page.goto("/processing");
    
    const clearBtn = page.getByRole("button", { name: "Clear history" });
    await expect(clearBtn).toBeVisible();
    
    await clearBtn.click();
    await page.getByRole("button", { name: "Clear History", exact: true }).click();
    
    await expect(page.getByText("No runs match filters.")).toBeVisible();
    
    const count = await prisma.operationRun.count();
    expect(count).toBe(0);
  });

  test("Multi-batch enrichment reuses one run ID", async ({ page }) => {
    const requests: URL[] = [];
    const testRunId = "consolidated-run-id";

    await page.route("**/api/enrich?**", async (route) => {
      requests.push(new URL(route.request().url()));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          runId: testRunId,
          processed: 1,
          updated: 1,
          remaining: requests.length === 1 ? 1 : 0,
          errors: [],
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Advanced actions" }).click();
    await page.getByRole("button", { name: /Enrich all X/ }).click();
    await expect(page.getByText("Processing finished.")).toBeVisible();

    expect(requests).toHaveLength(2);
    expect(requests[0].searchParams.get("runId")).toBeNull();
    expect(requests[1].searchParams.get("runId")).toBe(testRunId);
    expect(requests.every((url) => url.searchParams.get("source") === "x")).toBe(true);
  });

  test("Stopping active runs persists the stopped status", async ({ page }) => {
    await page.goto("/processing");
    await page.getByRole("button", { name: "Stop all operations" }).click();
    await page.getByRole("button", { name: "Stop All", exact: true }).click();

    const runRow = page.locator('a[href*="runId=999001"]');
    await expect(runRow).toContainText("stopped");
    const run = await prisma.operationRun.findUnique({ where: { id: "999001" } });
    expect(run?.status).toBe("stopped");
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });
});
