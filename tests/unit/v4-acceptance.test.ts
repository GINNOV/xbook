// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getBookmarks } from "@/lib/bookmarks";
import { getBookmarksPageData } from "@/app/lib/bookmarks-fetcher";
import { GET as agentGet, POST as agentPost } from "@/app/api/agent/route";
import { POST as edit } from "@/app/api/enrich/edit/route";
import { generateEmbedding } from "@/lib/llm";
import { contentSnapshot, saveEmbeddingIfUnchanged } from "@/lib/embedding-index";
import { rmSync } from "node:fs";

const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-v4-acceptance-"));
  const path = join(fixture.directory, "fixture.db");
  const connection = new Database(path);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    connection.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  connection.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: path }) }) };
});
vi.mock("@/lib/llm", () => ({ generateEmbedding: vi.fn() }));

const vector = (values: number[]) => Buffer.from(new Float32Array(values).buffer);
const request = (body: unknown) => new Request("http://localhost/api/agent", {
  method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body),
});

async function seed() {
  await prisma.bookmark.createMany({ data: [
    { id: "relevant", source: "x", tweetUrl: "https://x.com/i/status/a", summary: "Zebra", category: "Testing", embedding: vector([1, 0]), importedAt: new Date("2020-01-01") },
    { id: "newest", source: "x", tweetUrl: "https://x.com/i/status/b", summary: "Apple", category: "Testing", embedding: vector([0.5, 0.8660254]), importedAt: new Date("2026-01-01") },
    { id: "wrong-source", source: "yt", tweetUrl: "https://youtube.com/watch?v=c", summary: "Yankee", embedding: vector([1, 0]), importedAt: new Date("2026-09-01") },
  ] });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(generateEmbedding).mockResolvedValue([1, 0]);
  await prisma.processingEvent.deleteMany();
  await prisma.llmRequestLog.deleteMany();
  await prisma.operationRun.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.bookmarkFolder.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(fixture.directory, { recursive: true, force: true });
});

describe("V1 independent acceptance", () => {
  it("defaults semantic results to relevance, preserving explicit import and keyword order", async () => {
    await seed();
    const query = { query: "Testing", semantic: true, source: "x", page: 1, pageSize: 20 };
    expect((await getBookmarks(query)).bookmarks.map(row => row.id)).toEqual(["relevant", "newest"]);
    expect((await getBookmarks({ ...query, sort: "import", dir: "desc" })).bookmarks.map(row => row.id)).toEqual(["newest", "relevant"]);
    expect((await getBookmarks({ ...query, semantic: false })).bookmarks.map(row => row.id)).toEqual(["newest", "relevant"]);
  });
  it("preserves default semantic order through library fetcher and agent API", async () => {
    await seed();
    const page = await getBookmarksPageData({ q: "Testing", semantic: "true", source: "x" }, 100);
    expect(page.data.bookmarks.map(row => row.id)).toEqual(["relevant", "newest"]);
    const response = await agentGet(new Request("http://localhost/api/agent?resource=bookmarks&q=Testing&semantic=true&source=x", { headers: { host: "localhost" } }));
    expect(response.status).toBe(200);
    expect((await response.json()).bookmarks.map((row: { id: string }) => row.id)).toEqual(["relevant", "newest"]);
  });
  it("honors an explicit agent API sort", async () => {
    await seed();
    const response = await agentGet(new Request("http://localhost/api/agent?resource=bookmarks&q=Testing&semantic=true&source=x&sort=import&dir=desc", { headers: { host: "localhost" } }));
    expect((await response.json()).bookmarks.map((row: { id: string }) => row.id)).toEqual(["newest", "relevant"]);
  });
});

describe("V2 independent acceptance", () => {
  it.each(["bad", "-3", "Infinity", "1.5", "0", "999999"])('returns fetched last-page data matching display for page %s', async (page) => {
    await seed();
    const result = await getBookmarksPageData({ source: "x", page }, 1);
    const expected = page === "999999" ? 2 : 1;
    expect(result.currentPage).toBe(expected);
    expect(result.data.bookmarks.map(row => row.id)).toEqual([expected === 2 ? "relevant" : "newest"]);
  });
  it.each(["bad", "Infinity", "-2", "0", "2.7"])('normalizes agent inputs for page %s', async (page) => {
    await seed();
    const response = await agentGet(new Request(`http://localhost/api/agent?resource=bookmarks&source=x&page=${page}&pageSize=bad`, { headers: { host: "localhost" } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.bookmarks).toHaveLength(2);
  });
  it("reports effective agent page after clamping and empty-page one", async () => {
    await seed();
    const response = await agentGet(new Request("http://localhost/api/agent?resource=bookmarks&source=x&page=999999&pageSize=1", { headers: { host: "localhost" } }));
    const body = await response.json();
    expect(body.page).toBe(2);
    expect(body.bookmarks.map((row: { id: string }) => row.id)).toEqual(["relevant"]);
    const empty = await getBookmarksPageData({ source: "x", page: "999999", category: "absent" }, 1);
    expect(empty.currentPage).toBe(1);
    expect(empty.data.bookmarks).toEqual([]);
  });
});

describe("V4 independent write-path acceptance", () => {
  it("rejects a delayed vector after an actual human edit and rolls back a failed checkpoint", async () => {
    await seed();
    const original = await prisma.bookmark.findUniqueOrThrow({ where: { id: "relevant" } });
    await edit(new Request("http://localhost/api/enrich/edit", { method: "POST", body: JSON.stringify({ bookmarkId: "relevant", summary: "Human correction", category: "Testing", tags: "new" }) }));
    expect(await prisma.$transaction(tx => saveEmbeddingIfUnchanged(tx, { id: original.id, snapshot: contentSnapshot(original), embedding: vector([0, 1]) }))).toBe(false);
    const current = await prisma.bookmark.findUniqueOrThrow({ where: { id: original.id } });
    expect(current.embedding).toBeNull();
    await expect(prisma.$transaction(async tx => {
      expect(await saveEmbeddingIfUnchanged(tx, { id: current.id, snapshot: contentSnapshot(current), embedding: vector([0, 1]) })).toBe(true);
      throw new Error("Checkpoint transaction failed");
    })).rejects.toThrow("Checkpoint transaction failed");
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: current.id } })).embedding).toBeNull();
  });
  it("UI edit invalidates an existing vector without losing read state", async () => {
    await seed();
    const readAt = new Date("2026-09-01");
    await prisma.bookmark.update({ where: { id: "relevant" }, data: { readAt } });
    const response = await edit(new Request("http://localhost/api/enrich/edit", { method: "POST", body: JSON.stringify({ bookmarkId: "relevant", summary: "Human correction", category: "Testing", tags: "new" }) }));
    expect(response.status).toBe(200);
    const row = await prisma.bookmark.findUniqueOrThrow({ where: { id: "relevant" } });
    expect(row.embedding).toBeNull();
    expect(row.summary).toBe("Human correction");
    expect(row.readAt).toEqual(readAt);
  });
  it.each(["updateBookmark", "appendBookmarkData", "upsertBookmark"])("agent %s invalidates vectors after indexed-content changes", async (action) => {
    await seed();
    const payload = action === "upsertBookmark" ? { action, bookmark: { id: "relevant", tweetUrl: "https://x.com/i/status/a", summary: "Human correction" } }
      : { action, bookmarkId: "relevant", data: { summary: "Human correction" } };
    const response = await agentPost(request(payload));
    expect(response.status).toBe(200);
    const row = await prisma.bookmark.findUniqueOrThrow({ where: { id: "relevant" } });
    expect(row.embedding).toBeNull();
    expect(row.summary).toContain("Human correction");
  });
});
