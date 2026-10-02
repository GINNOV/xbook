// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { prisma } from "@/lib/db";
import { POST as edit } from "@/app/api/enrich/edit/route";
import { POST as agent } from "@/app/api/agent/route";
import { POST as one } from "@/app/api/enrich/one/route";
import { POST as bulk } from "@/app/api/enrich/route";
import { POST as sync } from "@/app/api/bookmarks/embeddings/sync/route";
import { summarizeBookmark, generateEmbedding } from "@/lib/llm";
import { contentSnapshot, embeddingContentHash, saveEmbeddingIfUnchanged } from "@/lib/embedding-index";

const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-index-"));
  const databasePath = path.join(fixture.directory, "test.db");
  const db = new Database(databasePath);
  const migrations = path.join(process.cwd(), "prisma/migrations");
  for (const name of fs.readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) }) };
});
vi.mock("@/lib/llm", () => ({ summarizeBookmark: vi.fn(), generateEmbedding: vi.fn(), validateModelAvailability: vi.fn() }));

const embedding = Buffer.from(new Float32Array([1, 0]).buffer);
const initial = { summary: "Original", category: "Science", tags: "old" };
const request = (path: string, body?: unknown) => new Request(`http://localhost${path}`, {
  method: "POST", headers: { host: "localhost" }, body: body === undefined ? undefined : JSON.stringify(body),
});
async function seed() {
  return prisma.bookmark.create({ data: { id: "a", tweetUrl: "https://x.com/a", ...initial,
    embedding, embeddingContentHash: embeddingContentHash(initial), embeddingIndexedAt: new Date(), readAt: new Date("2025-01-01") } });
}
async function humanEdit() {
  return edit(request("/api/enrich/edit", { bookmarkId: "a", summary: "Human", category: "Science", tags: "new" }));
}
async function expectHumanPreserved() {
  const row = await prisma.bookmark.findUniqueOrThrow({ where: { id: "a" } });
  expect(row.summary).toBe("Human");
  expect(row.tags).toBe("new");
  expect(row.editedAt).not.toBeNull();
  expect(row.embedding).toBeNull();
  expect(row.embeddingContentHash).toBeNull();
  expect(row.embeddingIndexedAt).toBeNull();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.processingEvent.deleteMany();
  await prisma.llmRequestLog.deleteMany();
  await prisma.operationRun.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.settings.create({ data: { id: "default" } });
});
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });

describe("index freshness with real SQLite", () => {
  it("adds nullable metadata to an old database while preserving every row and display/read state", () => {
    const directory = mkdtempSync(join(tmpdir(), "xbook-old-index-"));
    const db = new Database(join(directory, "old.db"));
    try {
      const migrations = join(process.cwd(), "prisma/migrations");
      const names = readdirSync(migrations).filter((name) => /^\d/.test(name)).sort();
      const migration = "20261002110652_embedding_freshness";
      for (const name of names.filter((name) => name < migration)) db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
      db.prepare('INSERT INTO Bookmark (id,tweetUrl,summary,category,tags,embedding,readAt,editedAt) VALUES (?,?,?,?,?,?,?,?)').run("old", "https://x.com/old", "Keep", "Keep category", "Keep tags", embedding, 123456, 654321);
      const old = db.prepare<[], Record<string, unknown>>('SELECT * FROM Bookmark').get();
      db.exec(readFileSync(join(migrations, migration, "migration.sql"), "utf8"));
      expect(db.prepare('SELECT * FROM Bookmark').get()).toEqual({ ...old, embeddingContentHash: null, embeddingIndexedAt: null });
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("UI edits invalidate changed content and retain vectors for identical content", async () => {
    await seed();
    await edit(request("/api/enrich/edit", { bookmarkId: "a", ...initial }));
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: "a" } })).embedding).not.toBeNull();
    await humanEdit();
    await expectHumanPreserved();
  });

  it.each([
    { action: "upsertBookmark", bookmark: { id: "a", tweetUrl: "https://x.com/a", summary: "Changed" } },
    { action: "updateBookmark", bookmarkId: "a", data: { category: "Changed" } },
    { action: "appendBookmarkData", bookmarkId: "a", data: { tags: ["new"] } },
  ])("agent $action invalidates vectors for actual indexed content changes", async (body) => {
    await seed();
    const response = await agent(request("/api/agent", body));
    expect(response.status).toBe(200);
    const row = await prisma.bookmark.findUniqueOrThrow({ where: { id: "a" } });
    expect(row.embedding).toBeNull(); expect(row.embeddingContentHash).toBeNull(); expect(row.embeddingIndexedAt).toBeNull();
  });

  it("agent non-index writes and unchanged upserts retain vector metadata", async () => {
    await seed();
    expect((await agent(request("/api/agent", { action: "updateBookmark", bookmarkId: "a", data: { text: "Metadata" } }))).status).toBe(200);
    expect((await agent(request("/api/agent", { action: "upsertBookmark", bookmark: { id: "a", tweetUrl: "https://x.com/a", ...initial } }))).status).toBe(200);
    const row = await prisma.bookmark.findUniqueOrThrow({ where: { id: "a" } });
    expect(row.embedding).not.toBeNull(); expect(row.embeddingContentHash).toBe(embeddingContentHash(initial));
  });

  it("rejects an obsolete single enrichment response after a real UI edit", async () => {
    await seed();
    vi.mocked(summarizeBookmark).mockImplementation(async () => {
      await humanEdit(); return { summary: "Obsolete", category: "Other", tags: ["obsolete"], embedding: [0, 1] };
    });
    const response = await one(request("/api/enrich/one?bookmarkId=a"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ skipped: true, ok: false });
    await expectHumanPreserved();
    expect(await prisma.operationRun.findFirst()).toMatchObject({ updated: 0, skipped: 1 });
  });

  it("bulk enrichment records skipped instead of updated after a UI edit", async () => {
    await seed();
    vi.mocked(summarizeBookmark).mockImplementation(async () => {
      await humanEdit(); return { summary: "Obsolete", category: "Other", tags: ["obsolete"], embedding: [0, 1] };
    });
    const response = await bulk(request("/api/enrich?reprocess=true"));
    expect(await response.json()).toMatchObject({ ok: true, updated: 0, skipped: 1 });
    await expectHumanPreserved();
    expect(await prisma.operationRun.findFirst()).toMatchObject({ updated: 0, skipped: 1 });
  });

  it("sync rejects a generated vector when a UI edit changed its snapshot", async () => {
    await seed();
    await prisma.bookmark.update({ where: { id: "a" }, data: { embedding: null } });
    vi.mocked(generateEmbedding).mockImplementation(async () => { await humanEdit(); return [0, 1]; });
    const response = await sync(request("/api/bookmarks/embeddings/sync"));
    expect(await response.json()).toMatchObject({ updated: 0, skipped: 1, remaining: 1 });
    await expectHumanPreserved();
  });

  it("commits hash and timestamp with a current vector in the caller transaction", async () => {
    const row = await seed();
    expect(await prisma.$transaction((tx) => saveEmbeddingIfUnchanged(tx, { id: row.id, snapshot: contentSnapshot(row), embedding }))).toBe(true);
    const saved = await prisma.bookmark.findUniqueOrThrow({ where: { id: "a" } });
    expect(saved.embeddingContentHash).toBe(embeddingContentHash(initial));
    expect(saved.embeddingIndexedAt).not.toBeNull();
    expect(saved.readAt).toEqual(row.readAt);
  });

  it("rolls back vector metadata when its caller transaction checkpoint fails", async () => {
    const row = await seed();
    await prisma.bookmark.update({ where: { id: row.id }, data: { embedding: null, embeddingContentHash: null, embeddingIndexedAt: null } });
    await expect(prisma.$transaction(async (tx) => {
      await saveEmbeddingIfUnchanged(tx, { id: row.id, snapshot: contentSnapshot(row), embedding });
      throw new Error("Checkpoint failure");
    })).rejects.toThrow("Checkpoint failure");
    const saved = await prisma.bookmark.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.embedding).toBeNull(); expect(saved.embeddingContentHash).toBeNull(); expect(saved.embeddingIndexedAt).toBeNull();
  });
});
