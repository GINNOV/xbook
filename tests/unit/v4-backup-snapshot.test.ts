// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { BackupAlreadyExistsError, createBackup, getBackupDir, listBackups, readDatabaseSnapshot } from "@/lib/db-backup";
import { GET as download } from "@/app/api/settings/database/backup/route";
import { POST as saveBackup } from "@/app/api/settings/database/backups/route";

// Backup snapshots do not use Prisma. Block access to the application's database.
vi.mock("@/lib/db", () => ({ prisma: {} }));

let directory: string;
let databasePath: string;
let writer: Database.Database;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-backup-test-"));
  databasePath = path.join(directory, "active.db");
  vi.stubEnv("DATABASE_URL", `file:${databasePath}`);
  writer = new Database(databasePath);
  writer.pragma("journal_mode = WAL");
  writer.pragma("wal_autocheckpoint = 0");
  writer.exec("CREATE TABLE Settings (id TEXT PRIMARY KEY, xBearerToken TEXT, xClientSecret TEXT, xAccessToken TEXT, xRefreshToken TEXT, xTokenExpiresAt TEXT, xScope TEXT, xTokenType TEXT, ytClientSecret TEXT, ytAccessToken TEXT, ytRefreshToken TEXT, ytTokenExpiresAt TEXT, ytScope TEXT, ytTokenType TEXT, llmApiKey TEXT); CREATE TABLE OAuthSession (id TEXT PRIMARY KEY);");
  writer.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE details (id INTEGER PRIMARY KEY);");
  writer.pragma("wal_checkpoint(TRUNCATE)");
  writer.prepare("INSERT INTO records VALUES (?, ?)").run(1, "Committed only in WAL");
  writer.prepare("INSERT INTO details VALUES (?)").run(1);
});

afterEach(() => {
  if (writer.open) writer.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function assertSnapshot(snapshotPath: string) {
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(snapshot.prepare("SELECT value FROM records WHERE id = 1").pluck().get()).toBe("Committed only in WAL");
    expect(snapshot.prepare("SELECT COUNT(*) FROM records").pluck().get())
      .toBe(snapshot.prepare("SELECT COUNT(*) FROM details").pluck().get());
  } finally {
    snapshot.close();
  }
}

describe("WAL-safe database backups", () => {
  it("includes committed WAL data with an open writer and concurrent transactions", async () => {
    expect(fs.statSync(`${databasePath}-wal`).size).toBeGreaterThan(0);
    const rawCopy = path.join(directory, "raw-copy.db");
    fs.copyFileSync(databasePath, rawCopy);
    const rawDatabase = new Database(rawCopy, { readonly: true });
    expect(rawDatabase.prepare("SELECT COUNT(*) FROM records").pluck().get()).toBe(0);
    rawDatabase.close();

    const insertRecord = writer.prepare("INSERT INTO records VALUES (?, ?)");
    const insertDetail = writer.prepare("INSERT INTO details VALUES (?)");
    writer.transaction(() => {
      for (let id = 2; id <= 5000; id++) {
        insertRecord.run(id, "x".repeat(1024));
        insertDetail.run(id);
      }
    })();
    let writesDuringSnapshot = 0;
    let snapshotFinished = false;
    const pending = createBackup("concurrent").finally(() => { snapshotFinished = true; });
    const writeConcurrently = async () => {
      for (let id = 5001; id <= 5012; id++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        writer.transaction(() => {
          insertRecord.run(id, "Concurrent committed value");
          insertDetail.run(id);
        })();
        if (!snapshotFinished) writesDuringSnapshot++;
      }
    };
    const [result] = await Promise.all([pending, writeConcurrently()]);
    expect(writesDuringSnapshot).toBeGreaterThan(0);
    expect(writer.open).toBe(true);
    assertSnapshot(result.path);
    expect(fs.readdirSync(getBackupDir())).toEqual(["concurrent.db"]);
  });

  it("preserves a named backup when a later request uses the same name", async () => {
    const original = await createBackup("named");
    const originalBytes = fs.readFileSync(original.path);
    writer.prepare("UPDATE records SET value = ? WHERE id = 1").run("Changed afterwards");
    await expect(createBackup("named")).rejects.toBeInstanceOf(BackupAlreadyExistsError);
    expect(fs.readFileSync(original.path)).toEqual(originalBytes);
    expect(listBackups().map((backup) => backup.filename)).toEqual(["named.db"]);
    expect(fs.readdirSync(getBackupDir())).toEqual(["named.db"]);
  });

  it("publishes only one complete backup when identical names race", async () => {
    const outcomes = await Promise.allSettled([createBackup("race"), createBackup("race")]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    expect(failure?.reason).toBeInstanceOf(BackupAlreadyExistsError);
    assertSnapshot(path.join(getBackupDir(), "race.db"));
    expect(fs.readdirSync(getBackupDir())).toEqual(["race.db"]);
  });

  it("awaits completed snapshots in the API and reports name conflicts", async () => {
    const request = () => new Request("http://localhost/api/settings/database/backups", {
      method: "POST", body: JSON.stringify({ customName: "from-api" }),
    });
    const response = await saveBackup(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, filename: "from-api.db" });
    assertSnapshot(path.join(getBackupDir(), "from-api.db"));
    expect((await saveBackup(request())).status).toBe(409);
  });

  it("downloads a valid WAL snapshot and removes the temporary copy after reading", async () => {
    const temporaryDirectories = vi.spyOn(fsPromises, "mkdtemp");
    const synchronousDirectories = vi.spyOn(fs, "mkdtempSync");
    const response = await download(new Request("http://localhost/api/settings/database/backup"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("xbook-backup-");
    const output = path.join(directory, "download.db");
    fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
    assertSnapshot(output);
    const temporaryResults = [...temporaryDirectories.mock.results, ...synchronousDirectories.mock.results];
    expect(temporaryResults).toHaveLength(1);
    for (const result of temporaryResults) {
      expect(fs.existsSync(await result.value)).toBe(false);
    }
    expect(fs.existsSync(path.join(directory, "backups"))).toBe(false);
    expect(writer.open).toBe(true);
  });

  it("cleans partial snapshots when SQLite rejects a corrupt source", async () => {
    writer.close();
    fs.writeFileSync(databasePath, "This is not a SQLite database");
    const temporaryDirectories = vi.spyOn(fs, "mkdtempSync");
    await expect(createBackup("broken")).rejects.toThrow();
    await expect(readDatabaseSnapshot()).rejects.toThrow();
    expect(fs.readdirSync(getBackupDir())).toEqual([]);
    for (const result of temporaryDirectories.mock.results) {
      expect(fs.existsSync(result.value)).toBe(false);
    }
  });
});
