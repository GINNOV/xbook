// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { POST } from "@/app/api/import/route";
import { prisma } from "@/lib/db";
import { importOperationAdapter } from "@/lib/import-job-adapter";
import { readOperationJob, runOperationJob } from "@/lib/operation-job";
const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { default: Database } = await import("better-sqlite3"); const { PrismaClient } = await import("@prisma/client"); const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-x-import-")); const databasePath = path.join(fixture.directory, "test.db"); const db = new Database(databasePath);
  const migrations = path.join(process.cwd(), "prisma/migrations"); for (const name of fs.readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) db.exec(fs.readFileSync(path.join(migrations, name, "migration.sql"), "utf8")); db.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) }) };
});
beforeEach(async () => { vi.restoreAllMocks(); await prisma.processingEvent.deleteMany(); await prisma.operationRun.deleteMany(); await prisma.bookmark.deleteMany(); await prisma.bookmarkFolder.deleteMany(); await prisma.usageMonth.deleteMany(); await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} }); await prisma.settings.update({ where: { id: "default" }, data: { monthlyCap: 1000, xAccessToken: "valid-token", xUserId: "user-123", xApiBase: "https://api.x.com/2", xTokenExpiresAt: null, lastBookmarkId: null } }); });
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
async function finish(runId: string) { let run = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } }); for (let step = 0; step < 10 && run.status === "queued"; step++) run = await runOperationJob(prisma, { runId, adapter: importOperationAdapter() }); return run; }
describe("X durable folder imports", () => {
  it("discovers folders, fetches IDs without forbidden parameters, hydrates new IDs, then imports global bookmarks", async () => {
    const requests = vi.spyOn(global, "fetch").mockResolvedValueOnce(response({ data: [{ id: "11", name: "Tech" }] })).mockResolvedValueOnce(response({ data: [{ id: "1" }], meta: {} })).mockResolvedValueOnce(response({ data: [{ id: "1", text: "tech content" }] })).mockResolvedValueOnce(response({ data: [{ id: "2", text: "global content" }], meta: {} }));
    const submitted = await POST(new Request("http://localhost/api/import?source=x", { method: "POST" })); expect(submitted.status).toBe(202); expect(requests).not.toHaveBeenCalled(); const { runId } = await submitted.json();
    const run = await finish(runId); expect(run.status).toBe("completed"); expect(readOperationJob(run)?.import).toMatchObject({ imported: 2, pagesFetched: 2, foldersCompleted: 1 }); expect(await prisma.bookmark.count()).toBe(2); expect((await prisma.bookmarkFolder.findUnique({ where: { id: "11" } }))?.lastFetchedAt).toBeInstanceOf(Date);
    const folderRequest = new URL(String(requests.mock.calls[1][0])); expect(folderRequest.pathname).toContain("/bookmarks/folders/11"); expect(folderRequest.searchParams.has("tweet.fields")).toBe(false); expect(folderRequest.searchParams.has("max_results")).toBe(false);
    const hydrateRequest = new URL(String(requests.mock.calls[2][0])); expect(hydrateRequest.pathname).toBe("/2/tweets"); expect(hydrateRequest.searchParams.has("tweet.fields")).toBe(true);
    const globalRequest = new URL(String(requests.mock.calls[3][0])); expect(globalRequest.pathname).toContain("/user-123/bookmarks"); expect(globalRequest.searchParams.has("tweet.fields")).toBe(true); expect(globalRequest.searchParams.has("max_results")).toBe(true);
    expect((await prisma.usageMonth.findFirst())?.usedBookmarks).toBe(2);
  });
  it("assigns known folder entries without paid hydration and refreshes global metadata preserving manual summaries", async () => {
    await prisma.bookmark.createMany({ data: [{ id: "known", tweetUrl: "https://x.com/i/status/known", summary: "manual", editedAt: new Date() }, { id: "baseline", tweetUrl: "https://x.com/i/status/baseline", summary: "existing" }] });
    const requests = vi.spyOn(global, "fetch").mockResolvedValueOnce(response({ data: [{ id: "11", name: "Tech" }] })).mockResolvedValueOnce(response({ data: [{ id: "known" }], meta: {} })).mockResolvedValueOnce(response({ data: [{ id: "new", text: "new content" }, { id: "baseline", text: "refreshed content" }], meta: {} }));
    const { runId } = await (await POST(new Request("http://localhost/api/import?source=x", { method: "POST" }))).json(); const run = await finish(runId);
    expect(run.status).toBe("completed"); expect(readOperationJob(run)?.import).toMatchObject({ imported: 1, refreshed: 2 }); expect(requests.mock.calls.map((call) => new URL(String(call[0])).pathname).some((path) => path === "/2/tweets")).toBe(false);
    expect(await prisma.bookmark.findUnique({ where: { id: "known" } })).toMatchObject({ folderId: "11", summary: "manual", editedAt: expect.any(Date) }); expect(await prisma.bookmark.findUnique({ where: { id: "baseline" } })).toMatchObject({ text: "refreshed content", summary: "existing" }); expect(await prisma.bookmark.count()).toBe(3); expect((await prisma.usageMonth.findFirst())?.usedBookmarks).toBe(1);
  });
});
