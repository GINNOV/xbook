// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup } from "@/lib/db-backup";
import { GET as download } from "@/app/api/settings/database/backup/route";
import { POST as namedBackup } from "@/app/api/settings/database/backups/route";
vi.mock("@/lib/db", () => ({ prisma: { $disconnect: vi.fn() } }));
let directory: string;
let source: Database.Database;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "xbook-snapshot-acceptance-"));
  const path = join(directory, "active.db");
  vi.stubEnv("DATABASE_URL", `file:${path}`);
  source = new Database(path);
  source.pragma("journal_mode = WAL");
  source.pragma("wal_autocheckpoint = 0");
  source.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  const insert = source.prepare("INSERT INTO fixture (id, body) VALUES (?, ?)");
  source.transaction(() => { for (let id = 1; id <= 1000; id++) insert.run(id, "committed".repeat(100)); })();
});
afterEach(() => { source.close(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
describe("V3 independent acceptance", () => {
  it("makes a reopenable coherent snapshot of committed WAL data during further writes", async () => {
    const pending = createBackup("wal-snapshot");
    source.transaction(() => { for (let id = 1001; id <= 1100; id++) source.prepare("INSERT INTO fixture VALUES (?, ?)").run(id, "later"); })();
    const result = await pending;
    const copy = new Database(result.path, { readonly: true });
    try {
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      const count = copy.prepare("SELECT COUNT(*) AS n FROM fixture").get() as { n: number };
      expect(count.n).toBeGreaterThanOrEqual(1000);
      expect(count.n).toBeLessThanOrEqual(1100);
      expect(copy.prepare("SELECT body FROM fixture WHERE id=1").get()).toEqual({ body: "committed".repeat(100) });
    } finally { copy.close(); }
  });
  it("returns a conflict without changing an earlier named backup", async () => {
    const first = await createBackup("same-name");
    const bytes = readFileSync(first.path);
    source.exec("INSERT INTO fixture VALUES (2000,'new write')");
    const response = await namedBackup(new Request("http://localhost/api/settings/database/backups", { method: "POST", body: JSON.stringify({ customName: "same-name" }) }));
    expect(response.status).toBe(409);
    expect(readFileSync(first.path)).toEqual(bytes);
  });
  it("downloads committed WAL rows in a standalone database file", async () => {
    const response = await download(new Request("http://localhost/api/settings/database/backup"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    const path = join(directory, "downloaded.db");
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    const copy = new Database(path, { readonly: true });
    try {
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(copy.prepare("SELECT COUNT(*) AS n FROM fixture").get()).toEqual({ n: 1000 });
    } finally { copy.close(); }
  });
});
