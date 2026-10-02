// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { prisma } from "@/lib/db";
import { updateOperationRun, incrementOperationRun } from "@/lib/processing";
import { resolveRunStatus, runStatusWhere } from "@/lib/run-outcome";
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
  await prisma.processingEvent.deleteMany();
  await prisma.operationRun.deleteMany();
});
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });
async function run(status = "running") {
  return prisma.operationRun.create({ data: { type: "enrichment_full", status, total: 10 } });
}
describe("processing outcomes and terminal fencing", () => {
  it("records total failure, partial success and remaining work honestly", async () => {
    const failed = await run();
    expect(await updateOperationRun(failed.id, { status: "completed", processed: 2, failed: 2, finish: true })).toMatchObject({ status: "failed", failed: 2 });
    const partial = await run();
    expect(await updateOperationRun(partial.id, { status: "completed", processed: 2, failed: 1, updated: 1, finish: true })).toMatchObject({ status: "partial" });
    const paused = await run();
    expect(await updateOperationRun(paused.id, { status: "completed", updated: 1, remaining: 9, finish: true })).toMatchObject({ status: "paused", finishedAt: null });
    const preflight = await run();
    expect(await updateOperationRun(preflight.id, { status: "completed", preflightError: true, notes: "Missing model", finish: true })).toMatchObject({ status: "failed", processed: 0 });
  });
  it("leaves stopped counters and finish time intact after late updates", async () => {
    const active = await run();
    const stopped = await updateOperationRun(active.id, { status: "stopped", notes: "User stopped", finish: true });
    await incrementOperationRun(active.id, { status: "running", processed: 1, updated: 1 });
    await updateOperationRun(active.id, { status: "completed", processed: 10, updated: 10, finish: true });
    expect(await prisma.operationRun.findUnique({ where: { id: active.id } })).toEqual(stopped);
  });
  it("does not revive terminal or paused runs through counter increments", async () => {
    for (const status of ["completed", "partial", "failed", "stopped", "paused"]) {
      const existing = await run(status);
      expect(await incrementOperationRun(existing.id, { status: "running", processed: 1, updated: 1 })).toEqual(existing);
    }
  });
  it("serializes a stop racing an increment without losing cancellation", async () => {
    for (let index = 0; index < 12; index++) {
      const active = await run();
      await Promise.all([
        updateOperationRun(active.id, { status: "stopped", finish: true }),
        incrementOperationRun(active.id, { status: "running", processed: 1, updated: 1 }),
      ]);
      const stopped = await prisma.operationRun.findUniqueOrThrow({ where: { id: active.id } });
      expect(stopped.status).toBe("stopped");
      expect(stopped.processed).toBe(stopped.updated);
      await incrementOperationRun(active.id, { status: "running", processed: 1, failed: 1 });
      expect(await prisma.operationRun.findUnique({ where: { id: active.id } })).toEqual(stopped);
    }
  });
  it("increments counters consistently before finalization", async () => {
    const active = await run();
    await Promise.all([
      incrementOperationRun(active.id, { processed: 1, updated: 1 }),
      incrementOperationRun(active.id, { processed: 1, failed: 1 }),
      incrementOperationRun(active.id, { processed: 1, skipped: 1 }),
    ]);
    expect(await prisma.operationRun.findUnique({ where: { id: active.id } })).toMatchObject({ processed: 3, updated: 1, failed: 1, skipped: 1 });
  });
  it("filters historical outcomes without changing stored logs", async () => {
    const rows = [
      { status: "completed", processed: 2, failed: 2 },
      { status: "completed", processed: 2, failed: 1, updated: 1 },
      { status: "completed", processed: 1, updated: 1, notes: "paused (more remaining)" },
      { status: "completed", processed: 1, updated: 1 },
    ];
    for (const data of rows) await prisma.operationRun.create({ data: { type: "embedding_sync", ...data } });
    for (const status of ["failed", "partial", "paused", "completed"]) {
      const matches = await prisma.operationRun.findMany({ where: runStatusWhere(status) });
      expect(matches).toHaveLength(1);
      expect(resolveRunStatus(matches[0])).toBe(status);
      expect(matches[0].status).toBe("completed");
    }
  });
});
