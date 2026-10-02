// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { prisma } from "@/lib/db";
import { runEmbeddingJob, submitEmbeddingJob } from "@/lib/embedding-job";
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

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function submit() {
  const submitted = await submitEmbeddingJob(prisma, { source: "x", limit: 2 });
  if (submitted.kind !== "ready") throw new Error("Expected job");
  return submitted.runId;
}
beforeEach(async () => {
  await prisma.processingEvent.deleteMany(); await prisma.operationRun.deleteMany(); await prisma.bookmark.deleteMany();
  await prisma.bookmark.createMany({ data: ["a", "b"].map((id) => ({ id, source: "x", tweetUrl: `https://x.com/${id}`, summary: id, category: "Science" })) });
});
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });

describe("durable embedding jobs", () => {
  it("reuses the active item list and rejects a second live claim", async () => {
    const runId = await submit();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const first = runEmbeddingJob(prisma, { runId, generate: async () => { started?.(); await blocked; return [1, 0]; } });
    await entered;
    expect(await submit()).toBe(runId);
    const secondProvider = vi.fn().mockResolvedValue([0, 1]);
    expect(await runEmbeddingJob(prisma, { runId, generate: secondProvider })).toMatchObject({ kind: "busy", updated: 0 });
    expect(secondProvider).not.toHaveBeenCalled(); expect(await prisma.operationRun.count()).toBe(1);
    release?.(); expect(await first).toMatchObject({ kind: "finished", updated: 2 });
    const resume = await runEmbeddingJob(prisma, { runId, generate: secondProvider });
    expect(resume).toMatchObject({ kind: "finished", updated: 2 }); expect(secondProvider).not.toHaveBeenCalled();
  });

  it("serializes simultaneous submissions from independent SQLite connections", async () => {
    const other = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: fixture.databasePath }) });
    try {
      const [first, second] = await Promise.all([
        submitEmbeddingJob(prisma, { source: "x", limit: 2 }),
        submitEmbeddingJob(other, { source: "x", limit: 2 }),
      ]);
      expect(first).toEqual(second); expect(await prisma.operationRun.count()).toBe(1);
    } finally { await other.$disconnect(); }
  }, 15_000);

  it("fences an expired worker after its provider returns", async () => {
    const runId = await submit();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const stale = runEmbeddingJob(prisma, { runId, leaseMs: 40, renewLease: false, generate: async () => { started?.(); await blocked; return [1, 0]; } });
    await entered; await pause(60);
    expect(await runEmbeddingJob(prisma, { runId, generate: async () => [0, 1] })).toMatchObject({ kind: "finished", updated: 2 });
    release?.(); expect(await stale).toMatchObject({ kind: "busy", updated: 2 });
    for (const row of await prisma.bookmark.findMany()) expect(Buffer.from(row.embedding ?? [])).toEqual(Buffer.from(new Float32Array([0, 1]).buffer));
    expect(await prisma.operationRun.findUnique({ where: { id: runId } })).toMatchObject({ updated: 2, processed: 2 });
  });

  it("renews the durable lease while a slow provider is awaited", async () => {
    const runId = await submit();
    expect(await runEmbeddingJob(prisma, { runId, leaseMs: 60, generate: async () => { await pause(160); return [1, 0]; } })).toMatchObject({ kind: "finished", updated: 2 });
  });

  it("honors persisted stop requests before publishing an awaited vector", async () => {
    const runId = await submit();
    const outcome = await runEmbeddingJob(prisma, { runId, generate: async () => {
      await prisma.operationRun.update({ where: { id: runId }, data: { status: "stopped" } }); return [1, 0];
    } });
    expect(outcome).toMatchObject({ kind: "stopped", updated: 0 });
    expect(await prisma.bookmark.count({ where: { embedding: null } })).toBe(2);
    const provider = vi.fn(); expect(await runEmbeddingJob(prisma, { runId, generate: provider })).toMatchObject({ kind: "stopped" }); expect(provider).not.toHaveBeenCalled();
  });

  it("recovers after SIGKILL and a fresh process without repeating committed writes", async () => {
    const runId = await submit();
    for (const name of ["embedding-vector", "embedding-index", "index-health", "embedding-job"]) {
      const source = readFileSync(join(process.cwd(), `src/lib/${name}.ts`), "utf8");
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
      writeFileSync(join(fixture.directory, `${name}.js`), compiled);
    }
    const worker = join(fixture.directory, "worker.cjs");
    writeFileSync(worker, `
      const { PrismaClient } = require('@prisma/client');
      const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
      const { runEmbeddingJob } = require('./embedding-job.js');
      const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.JOB_DB }) });
      let calls = 0;
      runEmbeddingJob(db, { runId: process.env.JOB_RUN, leaseMs: 180, renewLease: false,
        generate: async () => {
          calls++; console.log('CALL:' + calls);
          if (process.env.JOB_BLOCK === 'yes' && calls === 2) { console.log('BLOCKED'); await new Promise(() => {}); }
          return [0, 1];
        }
      }).then(async result => { console.log('RESULT:' + JSON.stringify(result)); await db.$disconnect(); }).catch(error => { console.error(error); process.exit(1); });
      if (process.env.JOB_BLOCK === 'yes') setInterval(() => {}, 1000);
    `);
    const launch = (block: string) => spawn(process.execPath, [worker], { env: { ...process.env, NODE_PATH: join(process.cwd(), "node_modules"), JOB_DB: fixture.databasePath, JOB_RUN: runId, JOB_BLOCK: block }, stdio: ["ignore", "pipe", "pipe"] });
    const first = launch("yes");
    const firstExit = once(first, "exit");
    let firstOutput = "";
    first.stderr.on("data", (chunk: Buffer) => { firstOutput += chunk.toString(); });
    const reached = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Worker did not checkpoint: ${firstOutput}`)), 5000);
      first.stdout.on("data", (chunk: Buffer) => { firstOutput += chunk.toString(); if (firstOutput.includes("BLOCKED")) { clearTimeout(timeout); resolve(); } });
      first.once("error", reject);
      first.once("exit", () => {
        clearTimeout(timeout);
        if (!firstOutput.includes("BLOCKED")) reject(new Error(`Worker exited before checkpoint: ${firstOutput}`));
      });
    });
    try {
      await reached;
      expect(await prisma.operationRun.findUnique({ where: { id: runId } })).toMatchObject({ updated: 1, processed: 1 });
    } finally { first.kill("SIGKILL"); await firstExit; }
    const committed = await prisma.bookmark.findFirstOrThrow({ where: { embedding: { not: null } } });
    await pause(220);
    const second = launch("no"); let output = ""; let errors = "";
    second.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); }); second.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
    const [exit] = await once(second, "exit");
    expect(exit, errors).toBe(0); expect(output).toContain('"updated":2'); expect(output.match(/CALL:/g)).toHaveLength(1);
    const same = await prisma.bookmark.findUniqueOrThrow({ where: { id: committed.id } });
    expect(same.embeddingIndexedAt).toEqual(committed.embeddingIndexedAt);
    expect(await prisma.operationRun.findUnique({ where: { id: runId } })).toMatchObject({ status: "completed", processed: 2, updated: 2 });
  }, 10_000);
});
