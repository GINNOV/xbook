// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { createMigratedDatabase, databaseRows, migrationNames, PRE_REPAIR_MIGRATION, seedLegacyAcceptance } from "../fixtures/migrated-database";

let directory: string;
let original: string;
let active: string;
let db: typeof import("@/lib/db") | undefined;
let before: ReturnType<typeof databaseRows>;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "xbook-migration-acceptance-")); original = join(directory, "pre-change.db"); active = join(directory, "copy.db");
  const legacy = createMigratedDatabase(original, PRE_REPAIR_MIGRATION); seedLegacyAcceptance(legacy); before = databaseRows(legacy);
  expect(before.columns.Bookmark).not.toContain("captureJson"); expect(before.columns.OperationRun).not.toContain("jobJson");
  legacy.close(); copyFileSync(original, active);
  vi.stubEnv("DATABASE_URL", `file:${active}`); vi.resetModules();
});
afterEach(async () => {
  await db?.disconnectDatabase(); db = undefined; global.prisma = undefined;
  vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
});
function assertPreserved() {
  const connection = new Database(active, { readonly: true });
  try {
    expect(databaseRows(connection, before.columns).rows).toEqual(before.rows);
    expect(connection.prepare("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL").get()).toEqual({ count: migrationNames().length });
    expect(connection.pragma("integrity_check", { simple: true })).toBe("ok"); expect(connection.pragma("foreign_key_check")).toEqual([]);
  } finally { connection.close(); }
}
it("migrates an actual old SQLite copy through Prisma CLI and restores its online backup without losing user records", async () => {
  const unchanged = readFileSync(original);
  execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${active}` }, stdio: "pipe", timeout: 30000 });
  assertPreserved(); expect(readFileSync(original)).toEqual(unchanged);
  db = await import("@/lib/db"); const maintenance = await import("@/lib/db-backup");
  const saved = await maintenance.createBackup("migration-acceptance");
  await db.prisma.$transaction(async (tx) => {
    await tx.bookmark.update({ where: { id: "agent-stable-id" }, data: { summary: "Temporary mutation", readAt: null, folderId: null } });
    await tx.settings.update({ where: { id: "default" }, data: { targetLanguage: "Temporary", llmModel: "temporary-model" } });
    await tx.llmRequestLog.deleteMany(); await tx.processingEvent.deleteMany();
  });
  expect(await maintenance.restoreBackup(join(maintenance.getBackupDir(), saved.filename))).toBe(true);
  assertPreserved();
  expect(await db.prisma.bookmark.count()).toBe(3);
  await db.prisma.bookmark.update({ where: { id: "agent-stable-id" }, data: { text: "Guarded write after restore" } });
  expect((await db.prisma.bookmark.findUniqueOrThrow({ where: { id: "agent-stable-id" } })).text).toBe("Guarded write after restore");
}, 30000);
it("staged historical restore upgrades every old table and preserves duplicate playlist memberships and agent IDs", async () => {
  const unchanged = readFileSync(original);
  // The active deployment is current; only the synthetic original remains historical.
  rmSync(active); createMigratedDatabase(active).close();
  db = await import("@/lib/db"); const maintenance = await import("@/lib/db-backup");
  expect(await maintenance.restoreBackup(original)).toBe(true); assertPreserved();
  expect(readFileSync(original)).toEqual(unchanged);
  expect(await db.prisma.bookmark.findMany({ where: { source: "yt" }, select: { id: true, folderId: true }, orderBy: { id: "asc" } })).toEqual([
    { id: "yt:playlist-one:same-video", folderId: "yt:pl:playlist-one" }, { id: "yt:playlist-two:same-video", folderId: "yt:pl:playlist-two" },
  ]);
  expect((await db.prisma.operationRun.findUniqueOrThrow({ where: { id: "agent-stable-run" } })).jobJson).toBeNull();
  expect((await db.prisma.bookmark.findUniqueOrThrow({ where: { id: "agent-stable-id" } })).embeddingContentHash).toBeNull();
});
