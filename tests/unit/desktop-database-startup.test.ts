// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";
import { DatabaseMaintenance, writeRestoreJournal } from "@/lib/database-maintenance";

const require = createRequire(import.meta.url);
const { runtimePaths, prepareDatabaseStartup, migrateDatabase } = require("../../start-server.js");
const { compileMaintenance, validateNodeBinary } = require("../../scripts/desktop-runtime.js");
let directory: string;
let active: string;
let compiled: string;
const migrationDirectory = path.resolve("prisma/migrations");
const migrationNames = fs.readdirSync(migrationDirectory).filter((name) => fs.existsSync(path.join(migrationDirectory, name, "migration.sql"))).sort();
const oldMigrationCount = migrationNames.length - 1;
const lastMigration = migrationNames.at(-1);
if (!lastMigration || oldMigrationCount < 1) throw new Error("Startup fixtures require at least two known migrations.");

function fixture(filename: string, id: string, limit: number) {
  const db = new Database(filename);
  db.exec("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_steps_count INTEGER NOT NULL DEFAULT 0)");
  for (const name of migrationNames.slice(0, limit)) {
    const sql = fs.readFileSync(path.join(migrationDirectory, name, "migration.sql"), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count) VALUES (?,?,CURRENT_TIMESTAMP,?,1)").run(randomUUID(), createHash("sha256").update(sql).digest("hex"), name);
  }
  db.prepare("INSERT INTO Bookmark(id,tweetUrl,text) VALUES (?,?,?)").run(id, "https://x.test/fixture", "Human original");
  db.close();
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-desktop-startup-"));
  active = path.join(directory, "active.db");
  compiled = path.join(directory, "database-maintenance.cjs");
  compileMaintenance(path.resolve("src/lib/database-maintenance.ts"), compiled);
  // Bootstrap dependencies resolve from the same packaged server directory.
  fs.symlinkSync(path.resolve("node_modules"), path.join(directory, "node_modules"), "dir");
  fs.cpSync(path.resolve("prisma"), path.join(directory, "prisma"), { recursive: true });
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });
const startup = (databasePath: string, migrate: () => Promise<void> | void, wait = true) => prepareDatabaseStartup({ databasePath, migrate, loadMaintenance: () => require(compiled), wait });
const deploy = () => migrateDatabase({ serverDirectory: directory, databaseUrl: `file:${active}`, logFile: path.join(directory, "migration.log") });

function tableColumns(db: Database.Database) {
  const tables = z.array(z.object({ name: z.string() })).parse(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all());
  return tables.map(({ name }) => ({ name, columns: db.pragma(`table_info("${name.replaceAll('"', '""')}")`) }));
}

function assertCurrentSchema(db: Database.Database) {
  const referencePath = path.join(directory, "current-reference.db");
  fixture(referencePath, "reference", Infinity);
  const reference = new Database(referencePath, { readonly: true });
  try {
    // Compare every application table, including Bookmark and OperationRun,
    // against this checkout's complete migration history.
    expect(tableColumns(db)).toEqual(tableColumns(reference));
    expect(db.prepare("SELECT COUNT(*) FROM _prisma_migrations").pluck().get()).toBe(migrationNames.length);
    expect(db.prepare("SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name=?").pluck().get(lastMigration)).toBe(1);
  } finally { reference.close(); }
}

function assertCurrent(id: string) {
  const db = new Database(active, { readonly: true });
  try {
    expect(db.prepare("SELECT id FROM Bookmark").pluck().get()).toBe(id);
    assertCurrentSchema(db);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(fs.existsSync(`${active}.restore.json`)).toBe(false);
  } finally { db.close(); }
}

describe("packaged startup restore recovery", () => {
  it("recovers the old original before deploying current migrations under ownership", async () => {
    fixture(active, "replacement", Infinity);
    const recovery = `${active}.recovery-old`;
    fixture(recovery, "original", oldMigrationCount);
    writeRestoreJournal(active, recovery, "replaced");
    await startup(active, () => {
      const recovered = new Database(active, { readonly: true });
      expect(recovered.prepare("SELECT id FROM Bookmark").pluck().get()).toBe("original");
      expect(recovered.prepare("SELECT COUNT(*) FROM _prisma_migrations").pluck().get()).toBe(oldMigrationCount);
      expect(recovered.prepare("SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name=?").pluck().get(lastMigration)).toBe(0);
      recovered.close();
      const competitor = new Database(`${active}.maintenance.sqlite`, { timeout: 0 });
      expect(() => competitor.exec("BEGIN IMMEDIATE")).toThrow(/locked/);
      competitor.close();
      deploy();
    });
    assertCurrent("original");
    expect(fs.existsSync(recovery)).toBe(false);
  });

  it("creates a first-launch SQLite file after recovery and applies every migration", async () => {
    expect(fs.existsSync(active)).toBe(false);
    await startup(active, deploy);
    const db = new Database(active, { readonly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) FROM Bookmark").pluck().get()).toBe(0);
      assertCurrentSchema(db);
    } finally { db.close(); }
  });

  it("retains a committed replacement and then migrates it", async () => {
    fixture(active, "replacement", oldMigrationCount);
    const recovery = `${active}.recovery-old`;
    fixture(recovery, "original", oldMigrationCount);
    writeRestoreJournal(active, recovery, "committed");
    await startup(active, deploy);
    assertCurrent("replacement");
  });

  it("holds ownership throughout asynchronous migration and excludes another backend", async () => {
    fixture(active, "original", Infinity);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = startup(active, async () => { entered?.(); await blocked; });
    await started;
    await expect(new DatabaseMaintenance(active).exclusive(async () => undefined, false)).rejects.toThrow("maintenance is busy");
    release?.(); await pending;
    await expect(new DatabaseMaintenance(active).exclusive(async () => "free", false)).resolves.toBe("free");
  });

  it("waits for a competing process before recovery and migration", async () => {
    fixture(active, "original", Infinity);
    new DatabaseMaintenance(active).initialize();
    const child: ChildProcess = spawn(process.execPath, ["-e", "const Database=require('better-sqlite3');const db=new Database(process.argv[1]+'.maintenance.sqlite');db.exec('BEGIN IMMEDIATE');process.send('owned');process.on('message',()=>{db.exec('COMMIT');db.close();process.exit(0)});", active], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
    try {
      await new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); });
      let migrated = false;
      await expect(startup(active, () => { migrated = true; }, false)).rejects.toThrow("maintenance is busy");
      expect(migrated).toBe(false);
      const pending = startup(active, () => { migrated = true; });
      child.send("release");
      await pending;
      expect(migrated).toBe(true);
    } finally { if (child.exitCode === null) { const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited; } }
  });

  it("releases ownership when migration fails and fails closed on missing resources", async () => {
    fixture(active, "original", Infinity);
    await expect(startup(active, () => { throw new Error("migration failure"); })).rejects.toThrow("migration failure");
    await expect(new DatabaseMaintenance(active).exclusive(async () => "free", false)).resolves.toBe("free");
    fs.rmSync(path.join(directory, "prisma/schema.prisma"));
    expect(deploy).toThrow("migration runtime or schema is missing");
  });

  it("isolates explicit database/log paths and validates the runtime native ABI", () => {
    expect(runtimePaths({ DATABASE_URL: `file:${active}` })).toEqual({ databasePath: active, databaseUrl: `file:${active}`, logFile: path.join(directory, "server.log") });
    expect(runtimePaths({}).databasePath).toBe(path.join(os.homedir(), ".xbook/dev.db"));
    expect(validateNodeBinary(process.execPath, process.cwd())).toBe(fs.realpathSync(process.execPath));
    expect(() => validateNodeBinary(path.join(directory, "missing-node"), process.cwd())).toThrow();
  });
});
