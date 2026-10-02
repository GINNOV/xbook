// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { prisma } from "@/lib/db";
import { POST as submit_POST } from "@/app/api/enrich/route";
import { POST as submit_one } from "@/app/api/enrich/one/route";
import { summarizeBookmark, validateLlmConnection } from "@/lib/llm";
import { stopOperationJob } from "@/lib/operation-job";
const fixture = vi.hoisted(() => ({ directory: "", databasePath: "" }));
vi.mock("@/lib/db", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-job-"));
  const databasePath = path.join(fixture.directory, "test.db");
  fixture.databasePath = databasePath;
  const db = new Database(databasePath);
  const migrations = path.join(process.cwd(), "prisma/migrations");
  for (const name of fs.readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) }) };
});




vi.mock("@/lib/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/llm")>(),
  summarizeBookmark: vi.fn(), validateLlmConnection: vi.fn(),
}));
beforeEach(async () => {
  vi.mocked(summarizeBookmark).mockReset().mockResolvedValue({ summary: "Done", category: "Tech", tags: [] });
  vi.mocked(validateLlmConnection).mockReset().mockResolvedValue(true);
  await prisma.processingEvent.deleteMany(); await prisma.operationRun.deleteMany(); await prisma.bookmark.deleteMany();
  await prisma.settings.upsert({ where: { id: "default" }, create: { id: "default", llmModel: "frozen-model", llmEmbeddingModel: "frozen-embedding" }, update: { llmModel: "frozen-model", llmEmbeddingModel: "frozen-embedding" } });
  await prisma.bookmark.createMany({ data: ["b1", "b2"].map((id) => ({ id, tweetUrl: `https://x.com/${id}`, text: id })) });
});
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });
const request = (query = "source=x&full=true") => new Request(`http://localhost/api/enrich?${query}`, { method: "POST" });
describe("enrichment durable route", () => {
  it("continues after an item failure and clears stale errors after successful retry", async () => {
    await prisma.bookmark.update({ where: { id: "b2" }, data: { enrichmentError: "Old error", enrichmentFailures: 1 } });
    vi.mocked(summarizeBookmark).mockRejectedValueOnce(new Error("Bad output"));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ status: "partial", ok: true, processed: 2, updated: 1, failed: 1 });
    expect(await prisma.bookmark.count({ where: { enrichmentFailures: 1, enrichmentError: "Bad output" } })).toBe(1);
    expect(await prisma.bookmark.count({ where: { summary: "Done", enrichmentError: null, enrichmentFailures: 0 } })).toBe(1);
  });
  it("uses blocked predicates for normal batches and includes them in full operations", async () => {
    await prisma.bookmark.updateMany({ data: { enrichmentFailures: 3 } });
    expect(await (await POST(request("source=x"))).json()).toMatchObject({ updated: 0, remaining: 0 });
    expect(await (await POST(request())).json()).toMatchObject({ updated: 2, status: "completed" });
  });
  it("preserves existing human edits unless replacement is explicit", async () => {
    await prisma.bookmark.update({ where: { id: "b1" }, data: { summary: "Human correction", editedAt: new Date() } });
    const response = await one(new Request("http://localhost/api/enrich/one?bookmarkId=b1", { method: "POST" }));
    expect(await response.json()).toMatchObject({ updated: 0, skipped: true });
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: "b1" } })).summary).toBe("Human correction");
    expect(summarizeBookmark).not.toHaveBeenCalled();
    expect(await (await one(new Request("http://localhost/api/enrich/one?bookmarkId=b1&replaceEdited=true", { method: "POST" }))).json()).toMatchObject({ updated: 1, bookmark: { summary: "Done" } });
  });
  it("passes frozen config and cannot revive a stopped run through a repeated POST", async () => {
    const response = await POST(request()); const body = await response.json();
    expect(summarizeBookmark).toHaveBeenCalledWith(expect.objectContaining({ connection: expect.objectContaining({ model: "frozen-model" }), embeddingConnection: expect.objectContaining({ model: expect.any(String) }) }));
    // Create a pending run by persisting a transient failure.
    await prisma.bookmark.updateMany({ data: { summary: null } });
    vi.mocked(summarizeBookmark).mockRejectedValue(new Error("Provider timed out"));
    const pending = await (await POST(request())).json();
    await stopOperationJob(prisma, pending.runId);
    await prisma.settings.update({ where: { id: "default" }, data: { llmModel: "changed-model" } });
    const stopped = await POST(request(`runId=${pending.runId}&source=x&full=true`));
    expect(stopped.status).toBe(409); expect(await stopped.json()).toMatchObject({ ok: false, stopped: true, status: "stopped" });
    expect((await prisma.operationRun.findUniqueOrThrow({ where: { id: body.runId } })).status).toBe("completed");
  });
  it("records preflight failure with zero attempted items and settings repair action", async () => {
    vi.mocked(validateLlmConnection).mockRejectedValue(new Error("Missing loaded model"));
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(502); expect(body).toMatchObject({ ok: false, processed: 0, status: "failed", repairAction: "/settings?tab=ai" });
    expect(summarizeBookmark).not.toHaveBeenCalled();
  });
  it("returns the run ID promptly and preserves idempotency after settings and candidates change", async () => {
    const initial = new Request("http://localhost/api/enrich?source=x&full=true", { method: "POST", headers: { "Idempotency-Key": "durable-action" } });
    const response = await submit_POST(initial);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ status: "queued", processed: 0 });
    expect(summarizeBookmark).not.toHaveBeenCalled();
    await prisma.settings.update({ where: { id: "default" }, data: { llmModel: "new-draft" } });
    await processOperationQueue();
    expect(summarizeBookmark).toHaveBeenCalledWith(expect.objectContaining({ connection: expect.objectContaining({ model: "frozen-model" }) }));
    const replay = await submit_POST(new Request(initial.url, { method: "POST", headers: { "Idempotency-Key": "durable-action" } }));
    expect(await replay.json()).toMatchObject({ runId: body.runId, updated: 2, status: "completed" });
    expect(await prisma.operationRun.count()).toBe(1);
    const changed = await submit_POST(new Request("http://localhost/api/enrich?source=yt&full=true", { method: "POST", headers: { "Idempotency-Key": "durable-action" } }));
    expect(changed.status).toBe(409);
  });
  it("persists missing-model submission failures with zero attempts and replayable IDs", async () => {
    vi.stubEnv("OPENAI_MODEL", "");
    await prisma.settings.update({ where: { id: "default" }, data: { llmModel: null } });
    const response = await submit_POST(new Request("http://localhost/api/enrich?source=x", { method: "POST", headers: { "Idempotency-Key": "missing-model" } }));
    const body = await response.json();
    expect(response.status).toBe(502); expect(body).toMatchObject({ processed: 0, status: "failed", repairAction: "/settings?tab=ai" });
    await prisma.settings.update({ where: { id: "default" }, data: { llmModel: "fixed-model" } });
    const replay = await submit_POST(new Request("http://localhost/api/enrich?source=x", { method: "POST", headers: { "Idempotency-Key": "missing-model" } }));
    expect(await replay.json()).toMatchObject({ runId: body.runId, status: "failed" });
    expect(await prisma.operationRun.count()).toBe(1);
    vi.unstubAllEnvs();
  });
  it("starts one background loop and recovers queued operations without a browser request", async () => {
    const { startOperationWorker } = await import("@/lib/operation-worker");
    const submitted = await submit_POST(request());
    const body = await submitted.json();
    await startOperationWorker();
    const worker = global.xbookOperationWorker;
    await startOperationWorker();
    expect(global.xbookOperationWorker).toBe(worker);
    for (let attempt = 0; attempt < 100 && (await prisma.operationRun.findUniqueOrThrow({ where: { id: body.runId } })).status !== "completed"; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await prisma.operationRun.findUnique({ where: { id: body.runId } })).toMatchObject({ status: "completed", updated: 2 });
    if (worker) clearInterval(worker.timer);
    global.xbookOperationWorker = undefined;
  });
  it("rejects malformed numeric parameters and resumes cannot change source scope", async () => {
    expect((await POST(request("limit=NaN"))).status).toBe(400);
    const body = await (await POST(request())).json();
    expect((await POST(request(`runId=${body.runId}&source=yt`))).status).toBe(409);
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
async function one(request: Request) {
  const response = await submit_one(request);
  if (response.status !== 202) return response;
  const body = await response.json();
  await processOperationQueue();
  const url = new URL(request.url); url.searchParams.set("runId", body.runId);
  return submit_one(new Request(url, { method: "POST" }));
}
