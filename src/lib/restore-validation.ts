import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";

export class InvalidRestoreError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidRestoreError"; }
}

const migrationSchema = z.array(z.object({ migration_name: z.string(), checksum: z.string(), finished_at: z.union([z.string(), z.number()]).nullable(), rolled_back_at: z.union([z.string(), z.number()]).nullable(), applied_steps_count: z.number() }));

function structure(db: Database.Database): string {
  const tables = z.array(z.object({ name: z.string() })).parse(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all());
  const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY type, name").all();
  return JSON.stringify({ objects, tables: tables.map(({ name }) => {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return { name, columns: db.pragma(`table_info(${quoted})`), foreignKeys: db.pragma(`foreign_key_list(${quoted})`), indexes: db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(name) };
  }) });
}

/** Validate the recorded historical schema, then migrate only the staged copy. */
export function validateRestoreCandidate(filename: string): void {
  let candidate: Database.Database | undefined;
  const expected = new Database(":memory:");
  try {
    candidate = new Database(filename, { fileMustExist: true });
    if (candidate.pragma("integrity_check", { simple: true }) !== "ok" || z.array(z.unknown()).parse(candidate.pragma("foreign_key_check")).length) throw new Error("SQLite integrity or relationship check failed.");
    const directory = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "prisma/migrations");
    const migrations = fs.readdirSync(directory).filter((name) => fs.existsSync(path.join(directory, name, "migration.sql"))).sort().map((name) => {
      const sql = fs.readFileSync(path.join(directory, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
    const history = migrationSchema.parse(candidate.prepare("SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name").all());
    if (!history.length || history.length > migrations.length) throw new Error("Unknown database migration version.");
    for (const [index, record] of history.entries()) {
      const migration = migrations[index];
      if (!migration || record.migration_name !== migration.name || record.checksum !== migration.checksum || !record.finished_at || record.rolled_back_at || record.applied_steps_count !== 1) throw new Error("Database migration history is incomplete or incompatible.");
      expected.exec(migration.sql);
    }
    if (structure(candidate) !== structure(expected)) throw new Error("Database schema does not match its migration history.");
    for (const migration of migrations.slice(history.length)) {
      candidate.exec(migration.sql);
      const now = new Date().toISOString();
      candidate.prepare("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)").run(randomUUID(), migration.checksum, now, migration.name, now);
      expected.exec(migration.sql);
    }
    if (structure(candidate) !== structure(expected) || candidate.pragma("integrity_check", { simple: true }) !== "ok" || z.array(z.unknown()).parse(candidate.pragma("foreign_key_check")).length) throw new Error("Migrated database validation failed.");
    candidate.pragma("journal_mode = DELETE");
  } catch (error) {
    throw new InvalidRestoreError(error instanceof Error ? `Cannot restore this backup: ${error.message}` : "Invalid database backup.");
  } finally { candidate?.close(); expected.close(); }
}
