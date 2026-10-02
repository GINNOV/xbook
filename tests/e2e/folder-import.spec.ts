import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { operationJobSchema } from "../../src/lib/operation-job";

const databaseUrl = process.env.XBOOK_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Missing disposable E2E database");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
const ids = ["951", "952", "953", "954", "yt:pl:R5one", "yt:pl:R5two"];
let provider: Server;
let origin: string;
let requests: string[];
let brokenFolder = true;
let pageEntries = ["r5-new-503"];

function checkpoint(run: { jobJson: string | null }) { return operationJobSchema.parse(JSON.parse(run.jobJson ?? "null")); }

test.beforeAll(async () => {
  provider = createServer(async (request, response) => {
    request.resume();
    const url = new URL(request.url ?? "/", "http://fixture");
    requests.push(url.pathname + url.search);
    response.setHeader("Content-Type", "application/json");
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (url.pathname.endsWith("/bookmarks/folders")) {
      response.end(JSON.stringify({ data: [{ id: "951", name: "R5 Alpha" }, { id: "952", name: "R5 Broken" }, { id: "953", name: "R5 Gamma" }] }));
    } else if (url.pathname.endsWith("/folders/952") && brokenFolder) {
      response.statusCode = 404; response.end(JSON.stringify({ error: "Folder removed by provider" }));
    } else if (url.pathname.includes("/bookmarks/folders/")) {
      const selected = url.pathname.endsWith("/951") ? ["r5-human-501", "r5-new-502"] : pageEntries;
      response.end(JSON.stringify({ data: selected.map((id) => ({ id })) }));
    } else if (url.pathname === "/2/tweets") {
      response.end(JSON.stringify({ data: (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).map((id) => ({ id, text: `Source refresh ${id}` })), includes: { users: [] } }));
    } else if (url.pathname.endsWith("/bookmarks")) {
      response.end(JSON.stringify({ data: [] }));
    } else { response.statusCode = 404; response.end(JSON.stringify({ error: "Unexpected fixture route" })); }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Missing provider listener");
  origin = `http://127.0.0.1:${address.port}/2`;
});
test.beforeEach(async () => {
  requests = []; brokenFolder = true; pageEntries = ["r5-new-503"];
  await prisma.settings.upsert({ where: { id: "default" }, update: { xApiBase: origin, xAccessToken: "fixture-token", xUserId: "fixture-user", monthlyCap: 10, ytAccessToken: null }, create: { id: "default", xApiBase: origin, xAccessToken: "fixture-token", xUserId: "fixture-user", monthlyCap: 10 } });
  await prisma.usageMonth.deleteMany({ where: { source: "x" } });
  await prisma.bookmarkFolder.createMany({ data: ids.map((id, index) => ({ id, name: ["R5 Alpha", "R5 Broken", "R5 Gamma", "R5 Empty", "R5 Playlist One", "R5 Playlist Two"][index] })) });
  await prisma.bookmark.createMany({ data: [
    { id: "r5-human-501", source: "x", tweetUrl: "https://x.com/i/status/501", folderId: "951", summary: "R5 human summary", category: "Human", editedAt: new Date("2026-01-01"), readAt: new Date("2026-01-01"), rawJson: '{"capture":{"text":"retained human source"}}', captureJson: '{"text":"retained durable source"}' },
    { id: "r5-yt-one", source: "yt", tweetUrl: "https://www.youtube.com/watch?v=R5samevideo", folderId: "yt:pl:R5one", summary: "R5 first playlist item" },
    { id: "r5-yt-two", source: "yt", tweetUrl: "https://www.youtube.com/watch?v=R5samevideo", folderId: "yt:pl:R5two", summary: "R5 second playlist item" },
  ] });
});
test.afterEach(async () => {
  const runs = await prisma.operationRun.findMany({ where: { source: "x", type: "x_folder_import" }, select: { id: true } });
  await prisma.operationRun.updateMany({ where: { id: { in: runs.map((run) => run.id) } }, data: { status: "stopped", cancelRequestedAt: new Date(), leaseOwner: null, leaseUntil: null, revision: { increment: 1 } } });
  await prisma.operationRun.deleteMany({ where: { id: { in: runs.map((run) => run.id) } } });
  await prisma.bookmark.deleteMany({ where: { id: { startsWith: "r5-" } } });
  await prisma.bookmarkFolder.deleteMany({ where: { id: { in: ids } } });
});
test.afterAll(async () => { await prisma.settings.update({ where: { id: "default" }, data: { xAccessToken: null, xUserId: null, xApiBase: null } }); provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve())); await prisma.$disconnect(); });

test("folder names and local counts open exact scopes including a useful empty state", async ({ page }) => {
  await page.goto("/folders?tab=x");
  await page.getByRole("link", { name: "R5 Alpha", exact: true }).click();
  await expect(page).toHaveURL(/source=x&folderId=951/);
  await expect(page.getByLabel("Folder", { exact: true })).toHaveValue("951");
  await expect(page.getByRole("button", { name: /^Read bookmark: R5 human summary/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Read bookmark: R5 first playlist item/ })).toHaveCount(0);
  await page.goto("/folders?tab=x");
  await page.getByRole("link", { name: "Open 0 local bookmarks in R5 Empty" }).click();
  await expect(page.getByRole("status").filter({ hasText: "This folder has no locally imported items yet" })).toBeVisible();
  await expect(page.getByLabel("Folder", { exact: true })).toHaveValue("954");
  await expect(page.getByRole("link", { name: "Import from Folder Management" })).toHaveAttribute("href", "/folders?tab=x");
  await page.goto("/folders?tab=yt");
  await expect(page.getByText("2 local playlist entries · 1 unique videos", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Open 1 local entries in R5 Playlist One" }).click();
  await expect(page.getByRole("button", { name: /^Read bookmark: R5 first playlist item/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Read bookmark: R5 second playlist item/ })).toHaveCount(0);
  await page.screenshot({ path: "docs/repair-evidence/r5-folder-scope.png", fullPage: true });
});

test("Import all continues after navigation and a failed folder, preserving manual edits", async ({ page }) => {
  const submissions: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/folders/import?")) submissions.push(request.url()); });
  await page.goto("/folders?tab=x");
  const submitted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/folders/import?"));
  await page.getByRole("button", { name: "Import all folders" }).click();
  const acknowledgment = await submitted; expect(acknowledgment.status()).toBe(202);
  const { runId } = await acknowledgment.json();
  await page.goto("/bookmarks?source=x");
  await expect.poll(async () => (await prisma.operationRun.findUnique({ where: { id: runId } }))?.status, { timeout: 15000 }).toBe("partial");
  const run = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  expect(checkpoint(run).import).toMatchObject({ imported: 2, foldersCompleted: 2, foldersFailed: 1 });
  expect(await prisma.bookmark.findUnique({ where: { id: "r5-human-501" } })).toMatchObject({ folderId: "951", summary: "R5 human summary", editedAt: new Date("2026-01-01"), readAt: new Date("2026-01-01"), captureJson: '{"text":"retained durable source"}' });
  expect(await prisma.bookmark.count({ where: { id: { startsWith: "r5-new-" } } })).toBe(2);
  await page.goto("/folders?tab=x");
  await expect(page.getByRole("link", { name: "View operation" })).toHaveAttribute("href", `/processing?runId=${runId}`);
  await expect(page.getByText(/Folder 952:.*404/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open 2 local bookmarks in R5 Alpha" })).toBeVisible();
  expect(submissions).toHaveLength(1);
  await page.screenshot({ path: "docs/repair-evidence/r5-import-all-partial.png", fullPage: true });
});

test("cap pause explains buffered work and resumes the same page without duplicate import", async ({ page }) => {
  pageEntries = ["r5-cap-601", "r5-cap-602"];
  await prisma.settings.update({ where: { id: "default" }, data: { monthlyCap: 1 } });
  await page.goto("/folders?tab=x");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "R5 Gamma", exact: true }) });
  const submitted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/folders/import?"));
  await row.getByRole("button", { name: "Import", exact: true }).click();
  const { runId } = await (await submitted).json();
  await expect(page.getByText("The new-entry cap paused this import", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Repair settings" })).toHaveAttribute("href", "/settings?tab=limits");
  let run = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  expect(checkpoint(run).import).toMatchObject({ imported: 1, pendingEntries: 1, capBlocked: true });
  await page.screenshot({ path: "docs/repair-evidence/r5-cap-recovery.png", fullPage: true });
  await prisma.settings.update({ where: { id: "default" }, data: { monthlyCap: 2 } });
  await page.getByRole("button", { name: "Resume operation" }).click();
  await expect.poll(async () => (await prisma.operationRun.findUnique({ where: { id: runId } }))?.status, { timeout: 10000 }).toBe("completed");
  run = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  expect(checkpoint(run).import).toMatchObject({ imported: 2, pendingEntries: 0, capBlocked: false });
  expect(await prisma.bookmark.count({ where: { id: { startsWith: "r5-cap-" } } })).toBe(2);
  expect(requests.filter((url) => url.includes("/bookmarks/folders/953"))).toHaveLength(1);
});
