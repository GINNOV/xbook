// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { prisma } from "@/lib/db";
import { POST as submit_POST } from "@/app/api/bookmarks/embeddings/sync/route";
import { generateEmbedding } from "@/lib/llm";
const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-outcome-"));
  const databasePath = path.join(fixture.directory, "test.db");
  const db = new Database(databasePath);
  const migrations = path.join(process.cwd(), "prisma/migrations");
  for (const name of fs.readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) }) };
});
vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  const generateEmbedding = vi.fn();
  return ({
    ...actual,
    generateEmbeddingResult: async (text: string, signal?: AbortSignal) => ({
      vector: await generateEmbedding(text, signal),
      identity: { model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 },
    }),
    getEffectiveEmbeddingIdentity: async () => {
      const settings = await prisma.settings.findUnique({ where: { id: "default" } });
      return { model: settings?.llmEmbeddingModel ?? "fixture-model", endpoint: settings?.llmEmbeddingBaseUrl ?? "http://localhost:1234/v1", dimensions: 2 };
    },
 generateEmbedding });
});
const request = () => new Request("http://localhost/api/bookmarks/embeddings/sync?source=x");
beforeEach(async () => {
  vi.mocked(generateEmbedding).mockReset().mockResolvedValue([0.1, 0.2]);
  await prisma.processingEvent.deleteMany(); await prisma.operationRun.deleteMany(); await prisma.bookmark.deleteMany();
  await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  await prisma.bookmark.createMany({ data: ["b1", "b2"].map((id) => ({ id, tweetUrl: `https://x.com/${id}`, summary: id, category: "Tech" })) });
});
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });
describe("durable embedding sync outcomes", () => {
  it("fails the run and response when every embedding attempt fails", async () => {
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("Provider failed"));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ ok: false, updated: 0, failed: 2, remaining: 2, skipped: 0, source: "x", error: "All 2 embedding attempts failed." });
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
    expect(await prisma.operationRun.findUnique({ where: { id: body.runId } })).toMatchObject({ status: "failed", processed: 2, failed: 2, updated: 0 });
    expect(await prisma.processingEvent.count({ where: { runId: body.runId, status: "failed" } })).toBe(2);
  });
  it("records failed vector writes without incrementing successful counters", async () => {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_vector BEFORE UPDATE OF embedding ON Bookmark BEGIN SELECT RAISE(ABORT, 'Database write failed'); END;`);
    try {
      const response = await POST(request()); const body = await response.json();
      expect(response.status).toBe(502); expect(body).toMatchObject({ ok: false, updated: 0, failed: 2 });
      expect(await prisma.bookmark.count({ where: { embedding: null } })).toBe(2);
    } finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_vector'); }
  });
  it("stops on a configuration error and preserves its message", async () => {
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("Connection refused"));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(502); expect(body).toMatchObject({ failed: 1, updated: 0, remaining: 2, error: "Connection refused" });
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    expect(await prisma.operationRun.findUnique({ where: { id: body.runId } })).toMatchObject({ status: "failed", processed: 1 });
  });
  it("records partial success after a generic failure", async () => {
    vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error("Provider failed"));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ ok: true, updated: 1, failed: 1, remaining: 1 });
    expect(await prisma.operationRun.findUnique({ where: { id: body.runId } })).toMatchObject({ status: "partial", processed: 2 });
  });
  it("pauses partial success when a later configuration error leaves work", async () => {
    await prisma.bookmark.create({ data: { id: "b3", tweetUrl: "https://x.com/b3", summary: "Third" } });
    vi.mocked(generateEmbedding).mockResolvedValueOnce([0.1, 0.2]).mockRejectedValueOnce(new Error("Missing embedding model"));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ ok: true, updated: 1, failed: 1, remaining: 2, error: "Missing embedding model" });
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
    expect(await prisma.operationRun.findUnique({ where: { id: body.runId } })).toMatchObject({ status: "paused", processed: 2 });
  });
  it("completes successful batches with actual vectors and terminal checkpoints", async () => {
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ ok: true, updated: 2, failed: 0, remaining: 0 });
    const rows = await prisma.bookmark.findMany();
    expect(rows.every((row) => row.embedding && row.embeddingContentHash && row.embeddingIndexedAt)).toBe(true);
    expect(await prisma.operationRun.findUnique({ where: { id: body.runId } })).toMatchObject({ status: "completed", processed: 2, updated: 2 });
    expect(await prisma.processingEvent.count()).toBe(0);
  });
  it("returns the existing no-work response without creating a run", async () => {
    await prisma.bookmark.deleteMany();
    const response = await POST(new Request("http://localhost/api/bookmarks/embeddings/sync"));
    expect(await response.json()).toEqual({ ok: true, updated: 0, failed: 0, remaining: 0, source: "all", message: "No bookmarks need embedding sync." });
    expect(await prisma.operationRun.count()).toBe(0); expect(generateEmbedding).not.toHaveBeenCalled();
  });
});

describe("embedding request resumption", () => {
  it("rejects a conflicting source instead of executing its active run", async () => {
    await prisma.operationRun.create({ data: { id: "active-x", type: "embedding_sync", source: "x", status: "queued", configJson: JSON.stringify({ embeddingJob: { version: 1, items: [{ id: "b1", status: "pending" }], owner: null, leaseUntil: 0, error: null } }) } });
    const response = await POST(new Request("http://localhost/api/bookmarks/embeddings/sync?source=yt"));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ runId: "active-x", busy: true });
    expect(generateEmbedding).not.toHaveBeenCalled(); expect(await prisma.operationRun.count()).toBe(1);
  });
  it("gives recovery guidance for a legacy active run with malformed config", async () => {
    await prisma.operationRun.create({ data: { id: "legacy", type: "embedding_sync", source: "x", configJson: "malformed" } });
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ runId: "legacy", error: expect.stringContaining("stop") });
    expect(generateEmbedding).not.toHaveBeenCalled();
    const resumed = await POST(new Request("http://localhost/api/bookmarks/embeddings/sync?runId=legacy"));
    expect(resumed.status).toBe(409);
  });
  it("returns the same completed runId without repeating provider calls", async () => {
    const first = await (await POST(request())).json();
    vi.mocked(generateEmbedding).mockClear();
    const resumed = await POST(new Request(`http://localhost/api/bookmarks/embeddings/sync?runId=${first.runId}`));
    expect(await resumed.json()).toMatchObject({ runId: first.runId, updated: 2, failed: 0 });
    expect(generateEmbedding).not.toHaveBeenCalled(); expect(await prisma.operationRun.count()).toBe(1);
  });
  it("returns accepted with the durable runId for a duplicate active request", async () => {
    let entered: (() => void) | undefined; const started = new Promise<void>((resolve) => { entered = resolve; });
    let release: (() => void) | undefined; const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(generateEmbedding).mockImplementation(async () => { entered?.(); await blocked; return [1, 0]; });
    const first = POST(request()); await started;
    const active = await prisma.operationRun.findFirstOrThrow();
    const second = await POST(request());
    expect(second.status).toBe(202); expect(await second.json()).toMatchObject({ status: "running", runId: active.id });
    expect(await prisma.operationRun.count()).toBe(1);
    release?.(); expect((await first).status).toBe(200);
  });
  it("uses the frozen model when settings change during provider work", async () => {
    vi.mocked(generateEmbedding).mockImplementation(async () => {
      await prisma.settings.update({ where: { id: "default" }, data: { llmEmbeddingModel: "changed-model" } });
      return [1, 0];
    });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body.updated).toBe(2);
    expect(await prisma.bookmark.count({ where: { embeddingModel: "fixture-model" } })).toBe(2);
    await prisma.settings.update({ where: { id: "default" }, data: { llmEmbeddingModel: null } });
  });
});

import { processOperationQueue } from "@/lib/operation-worker";
async function POST(request: Request) {
  const response = await submit_POST(request);
  if (response.status !== 202) return response;
  const body = await response.json();
  await processOperationQueue();
  const url = new URL(request.url); url.searchParams.set("runId", body.runId);
  return submit_POST(new Request(url, { method: "POST" }));
}
