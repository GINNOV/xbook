// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import ts from "typescript";
import Database from "better-sqlite3";
import { DatabaseMaintenance } from "@/lib/database-maintenance";

let directory: string;
let active: string;
let backup: string;
let db: typeof import("@/lib/db");
let restore: typeof import("@/lib/db-backup");

function fixture(filename: string, id: string, count = Infinity) {
  const connection = new Database(filename);
  connection.exec("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT current_timestamp, applied_steps_count INTEGER NOT NULL DEFAULT 0)");
  const directory = path.resolve("prisma/migrations");
  const names = fs.readdirSync(directory).filter((name) => fs.existsSync(path.join(directory, name, "migration.sql"))).sort().slice(0, count);
  for (const name of names) {
    const sql = fs.readFileSync(path.join(directory, name, "migration.sql"), "utf8");
    connection.exec(sql);
    connection.prepare("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)").run(randomUUID(), createHash("sha256").update(sql).digest("hex"), name);
  }
  connection.prepare('INSERT INTO BookmarkFolder (id,name,updatedAt) VALUES (?,?,CURRENT_TIMESTAMP)').run("folder", "Preserved folder");
  connection.prepare('INSERT INTO Bookmark (id,tweetUrl,text,folderId) VALUES (?,?,?,?)').run(id, `https://x.test/${id}`, `Content ${id}`, "folder");
  connection.prepare('INSERT INTO Settings (id,updatedAt) VALUES (?,CURRENT_TIMESTAMP)').run("default");
  connection.close();
}

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-restore-"));
  active = path.join(directory, "active.db"); backup = path.join(directory, "candidate.db");
  fixture(active, "original"); fixture(backup, "replacement");
  vi.stubEnv("DATABASE_URL", `file:${active}`);
  vi.resetModules();
  db = await import("@/lib/db");
  restore = await import("@/lib/db-backup");
});
afterEach(async () => {
  await db.disconnectDatabase();
  global.prisma = undefined;
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function worker(source: string): ChildProcess {
  for (const name of ["database-maintenance", "db", "restore-validation", "db-backup"]) {
    const input = fs.readFileSync(path.resolve(`src/lib/${name}.ts`), "utf8").replace(/"@\/lib\/([^" ]+)"/g, '"./$1.cjs"');
    fs.writeFileSync(path.join(directory, `${name}.cjs`), ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
  }
  return spawn(process.execPath, ["-e", source], { cwd: directory, env: { ...process.env, NODE_ENV: "production", DATABASE_URL: `file:${active}`, NODE_PATH: path.resolve("node_modules") }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
}

function message(child: ChildProcess) {
  return new Promise<unknown>((resolve, reject) => {
    const onMessage = (value: unknown) => { cleanup(); resolve(value); };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`Worker exited ${code}`)); };
    const cleanup = () => { child.off("message", onMessage); child.off("exit", onExit); };
    child.once("message", onMessage); child.once("exit", onExit);
  });
}

async function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL"); await ended;
}

async function originalWritable() {
  expect(await db.prisma.bookmark.findMany({ select: { id: true, folderId: true } })).toEqual([{ id: "original", folderId: "folder" }]);
  await db.prisma.bookmark.update({ where: { id: "original" }, data: { text: "Write after rejection" } });
}

describe("safe database restore", () => {
  it("restores relations/settings, reconnects, and supports batch and interactive transactions", async () => {
    await db.prisma.bookmark.findMany();
    expect(await restore.restoreBackup(backup)).toBe(true);
    expect(await db.prisma.bookmark.findMany({ include: { folder: true } })).toMatchObject([{ id: "replacement", folder: { id: "folder" } }]);
    await db.prisma.$transaction([db.prisma.bookmark.update({ where: { id: "replacement" }, data: { text: "batch write" } }), db.prisma.settings.update({ where: { id: "default" }, data: { monthlyCap: 42 } })]);
    await db.prisma.$transaction(async (tx) => { await tx.bookmark.update({ where: { id: "replacement" }, data: { text: "interactive write" } }); });
    expect((await db.prisma.settings.findUnique({ where: { id: "default" } }))?.monthlyCap).toBe(42);
    expect(fs.existsSync(`${active}.restore.json`)).toBe(false);
  });

  it("migrates an older known backup only in its staged copy", async () => {
    const count = fs.readdirSync(path.resolve("prisma/migrations")).filter((name) => /^\d/.test(name)).length;
    fs.unlinkSync(backup); fixture(backup, "legacy", count - 1);
    const unchanged = fs.readFileSync(backup);
    await restore.restoreBackup(backup);
    expect(await db.prisma.bookmark.findUnique({ where: { id: "legacy" } })).toMatchObject({ id: "legacy", text: "Content legacy", folderId: "folder" });
    const restored = new Database(active, { readonly: true });
    try { expect(restored.prepare("SELECT COUNT(*) AS count FROM _prisma_migrations").get()).toEqual({ count }); } finally { restored.close(); }
    expect(fs.readFileSync(backup)).toEqual(unchanged);
  });

  it.each(["corrupt", "foreign", "history-gap", "schema-lie", "unexpected-trigger", "unexpected-view", "history-trigger"])("rejects %s without touching active data", async (kind) => {
    if (kind === "corrupt") fs.writeFileSync(backup, "SQLite format 3\0garbage");
    else {
      const connection = new Database(backup);
      if (kind === "foreign") connection.exec("DROP TABLE _prisma_migrations");
      if (kind === "history-gap") connection.exec("DELETE FROM _prisma_migrations WHERE migration_name=(SELECT MIN(migration_name) FROM _prisma_migrations)");
      if (kind === "schema-lie") connection.exec("ALTER TABLE Bookmark ADD COLUMN unknown TEXT");
      if (kind === "unexpected-trigger") connection.exec("CREATE TRIGGER erase AFTER INSERT ON Bookmark BEGIN DELETE FROM Bookmark; END");
      if (kind === "unexpected-view") connection.exec("CREATE VIEW unexpected AS SELECT * FROM Bookmark");
      if (kind === "history-trigger") connection.exec("CREATE TRIGGER eraseHistory AFTER INSERT ON _prisma_migrations BEGIN DELETE FROM Bookmark; END");
      connection.close();
    }
    await expect(restore.restoreBackup(backup)).rejects.toThrow();
    await originalWritable();
  });

  it("rejects persisted active processing", async () => {
    await db.prisma.operationRun.create({ data: { type: "enrich", status: "running" } });
    await expect(restore.restoreBackup(backup)).rejects.toThrow("Stop active processing");
    await originalWritable();
  });

  it("rejects an import awaiting external work and reports invalid backup through the API", async () => {
    await db.prisma.importRun.create({ data: {} });
    await expect(restore.restoreBackup(backup)).rejects.toThrow("Stop active processing");
    await originalWritable();
    const { POST } = await import("@/app/api/settings/database/restore/route");
    fs.writeFileSync(path.join(restore.getBackupDir(), "corrupt.db"), "SQLite format 3\0garbage");
    const response = await POST(new Request("http://localhost/api/settings/database/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "corrupt.db" }) }));
    expect(response.status).toBe(400);
    await originalWritable();
  });

  it("rolls back an injected replacement failure", async () => {
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (String(source).endsWith("candidate.db") && destination === active) throw new Error("injected swap failure");
      return rename(source, destination);
    });
    await expect(restore.restoreBackup(backup)).rejects.toThrow("injected swap failure");
    await originalWritable();
    expect(fs.existsSync(`${active}.restore.json`)).toBe(false);
  });

  it("rolls back an injected reconnect failure and reconnects the original", async () => {
    vi.spyOn(db, "reconnectDatabase").mockRejectedValueOnce(new Error("injected reconnect failure"));
    await expect(restore.restoreBackup(backup)).rejects.toThrow("injected reconnect failure");
    await originalWritable();
  });

  it("recovers a process killed after replacement under startup ownership", async () => {
    await db.disconnectDatabase();
    const child = worker(`
      const fs = require('node:fs');
      const { DatabaseMaintenance, writeRestoreJournal } = require('./database-maintenance.cjs');
      const active = process.env.DATABASE_URL.slice(5);
      new DatabaseMaintenance(active).exclusive(async () => {
        const recovery = active + '.recovery-crash';
        fs.copyFileSync(active, recovery);
        writeRestoreJournal(active, recovery, 'prepared');
        fs.copyFileSync('candidate.db', active);
        writeRestoreJournal(active, recovery, 'replaced');
        process.send('replaced');
        await new Promise(()=>{});
      });
    `);
    try { expect(await message(child)).toBe("replaced"); } finally { await terminate(child); }
    new DatabaseMaintenance(active).initialize();
    await originalWritable();
    expect(fs.existsSync(`${active}.recovery-crash`)).toBe(false);
  });

  it("fences guarded Prisma transactions in another process and reconnects its stale client", async () => {
    const child = worker(`
      const { prisma } = require('./db.cjs');
      (async () => {
        await prisma.bookmark.findMany();
        process.send('connected');
        process.on('message', async (command) => {
          if (command === 'transaction') {
            await prisma.$transaction(async tx => {
              await tx.bookmark.update({where:{id:'original'},data:{text:'child write'}});
              process.send('transaction-owned');
              await new Promise(resolve => process.once('message', resolve));
            });
            process.send('transaction-finished');
          } else if (command === 'after-restore') {
            const row = await prisma.bookmark.update({where:{id:'replacement'},data:{text:'child after restore'}});
            process.send(row.id);
          }
        });
      })().catch(error => { console.error(error); process.exit(1); });
    `);
    try {
      expect(await message(child)).toBe("connected");
      child.send("transaction");
      expect(await message(child)).toBe("transaction-owned");
      await expect(restore.restoreBackup(backup)).rejects.toThrow("maintenance is busy");
      child.send("release");
      expect(await message(child)).toBe("transaction-finished");
      await restore.restoreBackup(backup);
      child.send("after-restore");
      expect(await message(child)).toBe("replacement");
      expect((await db.prisma.bookmark.findUnique({ where: { id: "replacement" } }))?.text).toBe("child after restore");
    } finally { await terminate(child); }
  });

  it("keeps generation durable when killed after committed journal cleanup before lease commit", async () => {
    const stale = worker(`
      const { prisma } = require('./db.cjs');
      (async () => {
        await prisma.bookmark.findMany(); process.send('connected');
        process.on('message', async () => {
          const row = await prisma.bookmark.update({where:{id:'replacement'},data:{text:'write after committed crash'}});
          process.send(row.id);
        });
      })().catch(error => { console.error(error); process.exit(1); });
    `);
    let restoring: ChildProcess | undefined;
    try {
      expect(await message(stale)).toBe("connected");
      restoring = worker(`
        const fs = require('node:fs');
        const { restoreBackup } = require('./db-backup.cjs');
        const active = process.env.DATABASE_URL.slice(5);
        const candidate = require('node:path').resolve('candidate.db');
        process.chdir(${JSON.stringify(process.cwd())});
        const remove = fs.rmSync;
        fs.rmSync = function(filename, ...args) {
          remove(filename, ...args);
          if (filename === active + '.restore.json') {
            process.send('committed-window');
            process.kill(process.pid, 'SIGSTOP');
          }
        };
        restoreBackup(candidate).catch(error => { console.error(error); process.exit(1); });
      `);
      expect(await message(restoring)).toBe("committed-window");
      await terminate(restoring);
      expect(fs.existsSync(`${active}.restore.json`)).toBe(false);
      expect(JSON.parse(fs.readFileSync(`${active}.generation`, "utf8"))).toBeGreaterThan(0);
      new DatabaseMaintenance(active).initialize();
      stale.send("write");
      expect(await message(stale)).toBe("replacement");
      expect((await db.prisma.bookmark.findUnique({ where: { id: "replacement" } }))?.text).toBe("write after committed crash");
    } finally { if (restoring) await terminate(restoring); await terminate(stale); }
  });

  it("rejects a competing process holding ownership and later permits writes", async () => {
    const code = `const Database = require('better-sqlite3'); const db = new Database(process.argv[1]+'.maintenance.sqlite'); db.exec('BEGIN IMMEDIATE'); console.log('owned'); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["-e", code, active], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${code}`))); });
      new DatabaseMaintenance(active).initialize();
      await expect(restore.restoreBackup(backup)).rejects.toThrow("maintenance is busy");
    } finally { child.kill("SIGKILL"); await new Promise<void>((resolve) => child.once("exit", () => resolve())); }
    await originalWritable();
  });

  it("rejects traversal and external symlink candidates in the restore API", async () => {
    const { POST } = await import("@/app/api/settings/database/restore/route");
    const request = (filename: unknown) => new Request("http://localhost/api/settings/database/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename }) });
    expect((await POST(request("../candidate.db"))).status).toBe(400);
    expect((await POST(request({ bad: "value" }))).status).toBe(400);
    fs.symlinkSync(backup, path.join(restore.getBackupDir(), "external.db"));
    expect((await POST(request("external.db"))).status).toBe(400);
    await originalWritable();
  });
});
