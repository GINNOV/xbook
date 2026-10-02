// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabaseExport } from "@/lib/db-export";

const credentialColumns = [
  "xBearerToken", "xClientSecret", "xAccessToken", "xRefreshToken",
  "ytClientSecret", "ytAccessToken", "ytRefreshToken", "llmApiKey",
];

describe("database downloads", () => {
  let directory: string;
  let dbPath: string;
  let source: Database.Database;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-export-test-"));
    dbPath = path.join(directory, "source.db");
    source = new Database(dbPath);
    const migrations = path.resolve("prisma/migrations");
    for (const entry of fs.readdirSync(migrations).sort()) {
      const sqlPath = path.join(migrations, entry, "migration.sql");
      if (fs.existsSync(sqlPath)) source.exec(fs.readFileSync(sqlPath, "utf8"));
    }
    source.pragma("journal_mode = WAL");
    source.pragma("wal_autocheckpoint = 0");
    source.prepare("INSERT INTO Settings (id, updatedAt, llmModel) VALUES ('default', CURRENT_TIMESTAMP, 'local-model')").run();
    for (const column of credentialColumns) {
      source.prepare(`UPDATE Settings SET "${column}" = ?`).run(`secret-${column}-do-not-export`);
    }
    source.prepare("INSERT INTO OAuthSession (state, codeVerifier) VALUES (?, ?)").run("oauth-state", "private-pkce-verifier");
    source.prepare("INSERT INTO Bookmark (id, tweetUrl, text) VALUES (?, ?, ?)").run("wal-bookmark", "https://x.com/example/status/1", "Saved in the WAL");
  });

  afterEach(() => {
    source.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("defaults to removing credentials and OAuth sessions without changing the source", async () => {
    const bytes = await createDatabaseExport(dbPath);
    const exported = new Database(bytes);
    try {
      for (const column of credentialColumns) {
        expect(exported.prepare(`SELECT "${column}" AS value FROM Settings`).get()).toEqual({ value: null });
        expect(bytes.includes(Buffer.from(`secret-${column}-do-not-export`))).toBe(false);
        expect(source.prepare(`SELECT "${column}" AS value FROM Settings`).get()).toEqual({ value: `secret-${column}-do-not-export` });
      }
      expect(exported.prepare("SELECT llmModel FROM Settings").get()).toEqual({ llmModel: "local-model" });
      expect(exported.prepare("SELECT text FROM Bookmark").get()).toEqual({ text: "Saved in the WAL" });
      expect(exported.prepare("SELECT * FROM OAuthSession").all()).toEqual([]);
      expect(bytes.includes(Buffer.from("private-pkce-verifier"))).toBe(false);
      expect(source.prepare("SELECT * FROM OAuthSession").all()).toHaveLength(1);
      expect(exported.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      exported.close();
    }
  });

  it("includes credentials only when requested, but never pending OAuth sessions", async () => {
    const bytes = await createDatabaseExport(dbPath, true);
    const exported = new Database(bytes);
    try {
      for (const column of credentialColumns) {
        expect(exported.prepare(`SELECT "${column}" AS value FROM Settings`).get()).toEqual({ value: `secret-${column}-do-not-export` });
      }
      expect(exported.prepare("SELECT * FROM OAuthSession").all()).toEqual([]);
      expect(exported.prepare("SELECT id FROM Bookmark").get()).toEqual({ id: "wal-bookmark" });
    } finally {
      exported.close();
    }
  });

  it("removes credentials from previously deleted SQLite pages", async () => {
    source.pragma("secure_delete = OFF");
    source.prepare("UPDATE Settings SET llmApiKey = ?").run("obsolete-secret".repeat(2000));
    source.prepare("UPDATE Settings SET llmApiKey = ?").run("current-secret");
    const bytes = await createDatabaseExport(dbPath);
    expect(bytes.includes(Buffer.from("obsolete-secret"))).toBe(false);
    expect(bytes.includes(Buffer.from("current-secret"))).toBe(false);
  });
});
