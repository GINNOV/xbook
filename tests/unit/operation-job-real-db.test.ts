// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { join } from "node:path";
import { recoverLegacyOperations, processOperationQueue } from "@/lib/operation-worker";
import { prisma } from "@/lib/db";
import { readOperationJob, runOperationJob, submitOperationJob, stopOperationJob, resumeOperationJob, type JobAdapter } from "@/lib/operation-job";
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



beforeEach(async () => {
  await prisma.processingEvent.deleteMany(); await prisma.operationRun.deleteMany(); await prisma.bookmark.deleteMany();
  await prisma.bookmark.createMany({ data: ["a", "b", "c"].map((id) => ({ id, tweetUrl: `https://x.com/${id}`, text: id })) });
});
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });
async function submit(key?: string, ids = ["a", "b", "c"], concurrency = 1) {
  const result = await submitOperationJob(prisma, { kind: "enrich", type: "enrichment_full", scope: { source: "x", folderId: null, replaceEdited: false }, settings: { model: "frozen", concurrency }, ids, idempotencyKey: key });
  if (result.kind !== "ready" || !result.run) throw new Error("Expected durable job");
  return result.run.id;
}
const adapter: JobAdapter = { execute: async (id) => async (tx) => { await tx.bookmark.update({ where: { id }, data: { summary: "saved" } }); return "updated"; } };
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
describe("generic durable operations", () => {
  it("reuses idempotent submissions even after completed candidates change", async () => {
    const runId = await submit("same-key");
    await runOperationJob(prisma, { runId, adapter });
    expect(await submit("same-key", [])).toBe(runId);
    expect(await prisma.operationRun.count()).toBe(1);
    const different = await submitOperationJob(prisma, { kind: "embedding", type: "embedding_sync", scope: { source: "x", folderId: null, replaceEdited: false }, settings: {}, ids: ["a"], idempotencyKey: "same-key" });
    expect(different.kind).toBe("conflict");
  });
  it("serializes independent database submissions and rejects overlapping scopes", async () => {
    const other = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: fixture.databasePath, timeout: 0 }) });
    const input = { kind: "enrich", type: "enrichment_full", scope: { source: "x", folderId: null, replaceEdited: false }, settings: {}, ids: ["a", "b"] } satisfies Parameters<typeof submitOperationJob>[1];
    try {
      const [first, second] = await Promise.all([submitOperationJob(prisma, input), submitOperationJob(other, input)]);
      expect(first).toEqual(second); expect(await prisma.operationRun.count()).toBe(1);
      expect((await submitOperationJob(other, { ...input, scope: { ...input.scope, source: "yt" } })).kind).toBe("conflict");
    } finally { await other.$disconnect(); }
  });
  it("allows one owner and resumes exact frozen scope after interruption", async () => {
    const runId = await submit();
    let entered: (() => void) | undefined; let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn(async (id: string, job) => { expect(job.settings.model).toBe("frozen"); entered?.(); await blocked; return adapter.execute(id, job, new AbortController().signal, runId); });
    const first = runOperationJob(prisma, { runId, adapter: { execute } });
    await ready;
    const other = vi.fn();
    expect((await runOperationJob(prisma, { runId, adapter: { execute: other } })).status).toBe("running");
    expect(other).not.toHaveBeenCalled();
    await prisma.bookmark.create({ data: { id: "later", tweetUrl: "https://x.com/later" } });
    release?.(); expect((await first).status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(3);
    expect((await prisma.bookmark.findUnique({ where: { id: "later" } }))?.summary).toBeNull();
  });
  it("persists cancellation and aborts the active provider before any commit", async () => {
    const runId = await submit();
    const controllers = new Map<string, AbortController>();
    let entered: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const task = runOperationJob(prisma, { runId, controllers, adapter: { execute: async (_id, _job, signal) => {
      entered?.(); await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); return async () => "updated";
    } } });
    await ready; await stopOperationJob(prisma, runId, controllers);
    expect(await task).toMatchObject({ status: "stopped", processed: 0 });
    const stopped = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
    expect(stopped.cancelRequestedAt).not.toBeNull();
    await runOperationJob(prisma, { runId, adapter });
    expect(await prisma.bookmark.count({ where: { summary: "saved" } })).toBe(0);
    await resumeOperationJob(prisma, runId);
    expect(await runOperationJob(prisma, { runId, adapter })).toMatchObject({ status: "completed", updated: 3 });
  });
  it("fences an expired owner from publishing or overwriting a newer owner", async () => {
    const runId = await submit();
    let entered: (() => void) | undefined; let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = runOperationJob(prisma, { runId, leaseMs: 30, renewLease: false, adapter: { execute: async () => {
      entered?.(); await blocked; return async (tx) => { await tx.bookmark.updateMany({ data: { summary: "expired" } }); return "updated"; };
    } } });
    await ready; await pause(40);
    expect(await runOperationJob(prisma, { runId, adapter })).toMatchObject({ status: "completed", updated: 3 });
    release?.(); await first;
    expect(await prisma.bookmark.count({ where: { summary: "expired" } })).toBe(0);
  });
  it("retains committed checkpoints across worker failure and retries only pending items", async () => {
    const runId = await submit(); let attempts = 0;
    await expect(runOperationJob(prisma, { runId, renewLease: false, adapter: { execute: async (id, job, signal) => {
      attempts++; if (id === "b") {
        await prisma.operationRun.update({ where: { id: runId }, data: { leaseUntil: new Date(0) } });
        throw new Error("Worker ended");
      }
      return adapter.execute(id, job, signal, runId);
    } } })).resolves.toMatchObject({ status: "running", updated: 1 });
    expect(attempts).toBe(2);
    const resumed = vi.fn(adapter.execute);
    expect(await runOperationJob(prisma, { runId, adapter: { execute: resumed } })).toMatchObject({ status: "completed", updated: 3 });
    expect(resumed.mock.calls.map(([id]) => id)).toEqual(["b", "c"]);
  });
  it("persists bounded transient retries and distinguishes partial and fatal outcomes", async () => {
    const runId = await submit();
    const failing: JobAdapter = { execute: async (id, job, signal) => { if (id === "a") throw new Error("Provider timed out"); return adapter.execute(id, job, signal, runId); } };
    expect(await runOperationJob(prisma, { runId, adapter: failing, retryDelayMs: 0 })).toMatchObject({ status: "queued", updated: 2, processed: 2 });
    expect(readOperationJob(await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } }))?.items[0]).toMatchObject({ attempts: 1, status: "pending" });
    await runOperationJob(prisma, { runId, adapter: failing, retryDelayMs: 0 });
    expect(await runOperationJob(prisma, { runId, adapter: failing, retryDelayMs: 0 })).toMatchObject({ status: "partial", updated: 2, failed: 1, processed: 3 });
    const resumed = await resumeOperationJob(prisma, runId);
    expect(resumed).toMatchObject({ status: "queued", updated: 2, failed: 0, processed: 2 });
    await stopOperationJob(prisma, runId);
    const next = await submit();
    expect(await runOperationJob(prisma, { runId: next, adapter: { preflight: async () => { throw new Error("Missing model"); }, execute: vi.fn() } })).toMatchObject({ status: "failed", processed: 0, notes: "Missing model" });
  });
  it("recovers legacy runs and finalizes a crash after the final durable item commit", async () => {
    const runId = await submit(undefined, ["a"]);
    const legacy = await prisma.operationRun.create({ data: { type: "enrichment_full", status: "running", notes: "Original failure context" } });
    const invalidIndex = await prisma.operationRun.create({ data: { type: "embedding_sync", status: "running", notes: "Original embedding diagnostics" } });
    const imported = await prisma.importRun.create({ data: { notes: "Original import diagnostics" } });
    await runOperationJob(prisma, { runId, adapter });
    await prisma.operationRun.update({ where: { id: runId }, data: { status: "running", leaseOwner: "dead-process", leaseUntil: new Date(0), finishedAt: null } });
    await recoverLegacyOperations();
    expect(await prisma.operationRun.findUnique({ where: { id: legacy.id } })).toMatchObject({ status: "failed", notes: expect.stringContaining("Start a new operation") });
    expect(await prisma.importRun.count({ where: { finishedAt: null } })).toBe(0);
    expect((await prisma.operationRun.findUniqueOrThrow({ where: { id: invalidIndex.id } })).notes).toBe("Original embedding diagnostics\nInterrupted older embedding run has no valid checkpoint. Start a new embedding sync.");
    const importAfter = await prisma.importRun.findUniqueOrThrow({ where: { id: imported.id } });
    expect(importAfter.notes).toBe("Original import diagnostics\nInterrupted older import. Start a new import to continue.");
    expect((await prisma.operationRun.findUniqueOrThrow({ where: { id: legacy.id } })).notes).toContain("Original failure context");
    await recoverLegacyOperations();
    expect((await prisma.importRun.findUniqueOrThrow({ where: { id: imported.id } })).notes).toBe(importAfter.notes);
    await processOperationQueue();
    expect(await prisma.operationRun.findUnique({ where: { id: runId } })).toMatchObject({ status: "completed", updated: 1 });
  });
  it("continues after SIGKILL of an independent worker without duplicating committed writes", async () => {
    const runId = await submit();
    for (const name of ["operation-job", "run-outcome", "import-job-contract"]) {
      let output = ts.transpileModule(readFileSync(join(process.cwd(), "src/lib", `${name}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      output = output.replace('require("zod")', `require(${JSON.stringify(join(process.cwd(), "node_modules/zod"))})`);
      writeFileSync(join(fixture.directory, `${name}.js`), output);
    }
    const script = `
      const {PrismaClient}=require(${JSON.stringify(join(process.cwd(), "node_modules/@prisma/client"))});
      const {PrismaBetterSqlite3}=require(${JSON.stringify(join(process.cwd(), "node_modules/@prisma/adapter-better-sqlite3"))});
      const {runOperationJob}=require(${JSON.stringify(join(fixture.directory, "operation-job.js"))});
      const db=new PrismaClient({adapter:new PrismaBetterSqlite3({url:${JSON.stringify(fixture.databasePath)}})});
      runOperationJob(db,{runId:${JSON.stringify(runId)},leaseMs:1000,adapter:{execute:async(id)=>{
        if(id==='b'){process.stdout.write('waiting\\n');await new Promise(()=>{});}
        return async(tx)=>{await tx.bookmark.update({where:{id},data:{summary:'child'}});return 'updated';};
      }}}).catch((error)=>{process.stderr.write(error.message);process.exit(1)});
      setInterval(()=>{},1000);
    `;
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Child did not enter provider: ${output}`)); }, 10000);
      child.stderr.on("data", (chunk) => { output += String(chunk); });
      child.stdout.on("data", () => { clearTimeout(timeout); resolve(); });
      child.on("exit", () => { clearTimeout(timeout); reject(new Error(output)); });
    });
    const competing = vi.fn(adapter.execute);
    expect(await runOperationJob(prisma, { runId, adapter: { execute: competing } })).toMatchObject({ status: "running", updated: 1 });
    expect(competing).not.toHaveBeenCalled();
    child.kill("SIGKILL"); await once(child, "exit"); await pause(1100);
    expect((await prisma.bookmark.findUniqueOrThrow({ where: { id: "a" } })).summary).toBe("child");
    const execute = vi.fn(adapter.execute);
    expect(await runOperationJob(prisma, { runId, adapter: { execute } })).toMatchObject({ status: "completed", updated: 3 });
    expect(execute.mock.calls.map(([id]) => id)).toEqual(["b", "c"]);
  }, 15000);
  it("retries transient preflight failures within a persisted budget without counting items", async () => {
    const runId = await submit();
    const preflight = vi.fn().mockRejectedValueOnce(new Error("503 temporarily unavailable")).mockResolvedValue(undefined);
    expect(await runOperationJob(prisma, { runId, adapter: { ...adapter, preflight }, retryDelayMs: 0 })).toMatchObject({ status: "queued", processed: 0 });
    expect(readOperationJob(await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } }))?.preflightAttempts).toBe(1);
    expect(await runOperationJob(prisma, { runId, adapter: { ...adapter, preflight }, retryDelayMs: 0 })).toMatchObject({ status: "completed", processed: 3 });
    expect(preflight).toHaveBeenCalledTimes(2);
  });
  it("rolls back an adapter's partial bookmark writes before recording its failure", async () => {
    const runId = await submit(undefined, ["a"]);
    const result = await runOperationJob(prisma, { runId, adapter: { execute: async () => async (tx) => {
      await tx.bookmark.update({ where: { id: "a" }, data: { summary: "Must roll back", category: "Must roll back" } });
      throw new Error("Commit failed after partial write");
    } } });
    expect(result).toMatchObject({ status: "failed", processed: 1, updated: 0, failed: 1 });
    expect(await prisma.bookmark.findUnique({ where: { id: "a" } })).toMatchObject({ summary: null, category: null });
    expect(readOperationJob(result)?.items[0]).toMatchObject({ status: "failed", attempts: 1 });
  });
  it("refuses to resume a stopped operation while another operation owns the library", async () => {
    const stoppedId = await submit(); await stopOperationJob(prisma, stoppedId);
    const stopped = await prisma.operationRun.findUniqueOrThrow({ where: { id: stoppedId } });
    const activeId = await submit();
    await expect(resumeOperationJob(prisma, stoppedId)).rejects.toMatchObject({ name: "OperationConflictError", runId: activeId });
    expect(await prisma.operationRun.findUnique({ where: { id: stoppedId } })).toEqual(stopped);
    expect(await prisma.operationRun.count({ where: { status: "queued" } })).toBe(1);
  });
  it("aborts an active provider after cancellation by another database connection", async () => {
    const runId = await submit();
    const other = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: fixture.databasePath }) });
    let entered: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const task = runOperationJob(prisma, { runId, leaseMs: 150, adapter: { execute: async (_id, _job, signal) => {
      entered?.(); await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); return async () => "updated";
    } } });
    try { await ready; await stopOperationJob(other, runId); expect(await task).toMatchObject({ status: "stopped", processed: 0 }); }
    finally { await other.$disconnect(); }
  });
  it("honors the frozen concurrency cap and commits each item once", async () => {
    const runId = await submit(undefined, ["a", "b", "c"], 2); let active = 0; let maximum = 0;
    const execute: JobAdapter["execute"] = async (id, job, signal) => { active++; maximum = Math.max(maximum, active); await pause(10); active--; return adapter.execute(id, job, signal, runId); };
    expect(await runOperationJob(prisma, { runId, adapter: { execute } })).toMatchObject({ status: "completed", processed: 3, updated: 3 });
    expect(maximum).toBe(2);
  });
});
