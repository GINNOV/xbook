// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dbPath: "" }));
vi.mock("@/lib/db-backup", () => ({ getDbPath: () => fixture.dbPath }));

import { GET } from "@/app/api/settings/database/backup/route";

let directory: string;
beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "xbook-download-name-"));
  fixture.dbPath = path.join(directory, "active.db");
  const db = new Database(fixture.dbPath);
  for (const entry of readdirSync("prisma/migrations").sort()) {
    const sqlPath = path.join("prisma/migrations", entry, "migration.sql");
    if (existsSync(sqlPath)) db.exec(readFileSync(sqlPath, "utf8"));
  }
  db.exec("CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('fixture')");
  db.close();
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("active database download", () => {
  it.each([
    ["before_enrichment", "before_enrichment.db"],
    ["before_enrichment.DB", "before_enrichment.db"],
    ["before_enrichment.sqlite", "before_enrichment.db"],
    ["../../other.db", "______other.db"],
    ["report\"\r\nX-Evil: yes.db", "report___X-Evil__yes.db"],
  ])("returns the active file under safe custom name %j", async (customName, expected) => {
    const query = new URLSearchParams({ customName });
    const response = await GET(new Request(`http://localhost/api/settings/database/backup?${query}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${expected}"`);
    expect(response.headers.has("X-Evil")).toBe(false);
    const exported = new Database(Buffer.from(await response.arrayBuffer()));
    try {
      expect(exported.prepare("SELECT value FROM example").get()).toEqual({ value: "fixture" });
      expect(exported.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      exported.close();
    }
  });

  it.each(["", "?customName=", "?customName=+++", "?customName=..%2F"])(
    "retains the default filename for %j",
    async (query) => {
      const response = await GET(new Request(`http://localhost/api/settings/database/backup${query}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="xbook-backup-\d{4}-\d{2}-\d{2}\.db"$/,
      );
    },
  );
});
