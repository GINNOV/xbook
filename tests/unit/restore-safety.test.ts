// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreBackup } from "@/lib/db-backup";

vi.mock("@/lib/db", () => ({ prisma: { $disconnect: vi.fn(), $connect: vi.fn() } }));

function makeDb(filename: string, id: string) {
  const database = new Database(filename);
  database.exec("CREATE TABLE Bookmark (id TEXT PRIMARY KEY, tweetUrl TEXT NOT NULL); CREATE TABLE Settings (id TEXT PRIMARY KEY);");
  database.prepare("INSERT INTO Bookmark VALUES (?, ?)").run(id, `https://x.com/${id}`);
  database.prepare("INSERT INTO Settings VALUES ('default')").run();
  database.close();
}

function readId(filename: string) {
  const database = new Database(filename, { readonly: true });
  try {
    return (database.prepare("SELECT id FROM Bookmark").get() as { id: string }).id;
  } finally {
    database.close();
  }
}

describe("safe restore", () => {
  const directories: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("rejects corrupt and incompatible files without changing the active database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "xbook-restore-"));
    directories.push(directory);
    const active = join(directory, "active.db");
    makeDb(active, "keep");
    vi.stubEnv("DATABASE_URL", `file:${active}`);
    const corrupt = join(directory, "corrupt.db");
    writeFileSync(corrupt, "not sqlite");
    await expect(restoreBackup(corrupt)).rejects.toThrow(/readable SQLite|integrity|not a database/i);
    expect(readId(active)).toBe("keep");

    const incompatible = join(directory, "other.db");
    const other = new Database(incompatible);
    other.exec("CREATE TABLE fixture (id INTEGER)");
    other.close();
    await expect(restoreBackup(incompatible)).rejects.toThrow(/incompatible/i);
    expect(readId(active)).toBe("keep");
  });

  it("rolls back an injected swap and replaces the database on success", async () => {
    const directory = mkdtempSync(join(tmpdir(), "xbook-restore-"));
    directories.push(directory);
    const active = join(directory, "active.db");
    const candidate = join(directory, "candidate.db");
    makeDb(active, "keep");
    makeDb(candidate, "restored");
    vi.stubEnv("DATABASE_URL", `file:${active}`);
    await expect(restoreBackup(candidate, { failAt: "swap" })).rejects.toThrow(/swap/i);
    expect(readId(active)).toBe("keep");
    await restoreBackup(candidate);
    expect(readId(active)).toBe("restored");
  });
});
