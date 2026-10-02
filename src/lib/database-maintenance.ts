import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";

export class DatabaseMaintenanceError extends Error {
  constructor(message = "Database maintenance is busy. Try again after processing stops.") {
    super(message);
    this.name = "DatabaseMaintenanceError";
  }
}

const journalSchema = z.object({
  version: z.literal(1),
  recovery: z.string(),
  stage: z.enum(["prepared", "replaced", "committed"]),
});

export function activeDatabasePath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return path.resolve(url.startsWith("file:") ? url.slice(5) : url);
}

export function removeDatabaseSidecars(databasePath: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

export function syncFile(filename: string) {
  const descriptor = fs.openSync(filename, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

export function syncDirectory(directory: string) {
  syncFile(directory);
}

export function writeRestoreJournal(databasePath: string, recovery: string, stage: "prepared" | "replaced" | "committed") {
  const journal = `${databasePath}.restore.json`;
  const temporary = `${journal}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, recovery, stage }), { mode: 0o600 });
  syncFile(temporary);
  fs.renameSync(temporary, journal);
  syncDirectory(path.dirname(databasePath));
}

/** Recovery runs under the same SQLite ownership lock as every application query. */
export function recoverInterruptedRestore(databasePath: string): boolean {
  const journalPath = `${databasePath}.restore.json`;
  if (!fs.existsSync(journalPath)) return false;
  const journal = journalSchema.parse(JSON.parse(fs.readFileSync(journalPath, "utf8")));
  const directory = path.dirname(databasePath);
  if (path.dirname(journal.recovery) !== directory || !(path.basename(journal.recovery).startsWith(`${path.basename(databasePath)}.recovery-`) || path.basename(journal.recovery) === `${path.basename(databasePath)}.recovery`)) {
    throw new Error("Restore recovery journal contains an invalid snapshot path.");
  }
  if (journal.stage !== "committed") {
    const snapshot = new Database(journal.recovery, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Restore recovery snapshot is corrupt.");
    } finally { snapshot.close(); }
    const replacement = `${databasePath}.rollback`;
    fs.copyFileSync(journal.recovery, replacement);
    syncFile(replacement);
    removeDatabaseSidecars(databasePath);
    fs.renameSync(replacement, databasePath);
    syncDirectory(directory);
  }
  fs.rmSync(journalPath);
  syncDirectory(directory);
  fs.rmSync(journal.recovery, { force: true });
  syncDirectory(directory);
  return true;
}

export class DatabaseMaintenance {
  private readonly context = new AsyncLocalStorage<boolean>();
  constructor(readonly databasePath: string) {}

  private openOwnership() {
    const ownershipPath = `${this.databasePath}.maintenance.sqlite`;
    fs.mkdirSync(path.dirname(ownershipPath), { recursive: true });
    const ownership = new Database(ownershipPath, { timeout: 0 });
    try {
      ownership.exec("CREATE TABLE IF NOT EXISTS ownership (id INTEGER PRIMARY KEY CHECK (id = 1), generation INTEGER NOT NULL); INSERT OR IGNORE INTO ownership VALUES (1, 0)");
      fs.chmodSync(ownershipPath, 0o600);
      return ownership;
    } catch (error) { ownership.close(); throw error; }
  }

  generation(ownership: Database.Database): number {
    if (!ownership.inTransaction) throw new Error("Database generation requires maintenance ownership.");
    const filename = `${this.databasePath}.generation`;
    return fs.existsSync(filename) ? z.number().int().nonnegative().parse(JSON.parse(fs.readFileSync(filename, "utf8"))) : 0;
  }

  invalidate(ownership: Database.Database) {
    // This counter must survive a killed owner even when its SQLite ownership
    // transaction rolls back. Write it durably before touching the active inode.
    const filename = `${this.databasePath}.generation`;
    const temporary = `${filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.generation(ownership) + 1), { mode: 0o600 });
    syncFile(temporary);
    fs.renameSync(temporary, filename);
    syncDirectory(path.dirname(filename));
  }

  private recover(ownership: Database.Database) {
    if (fs.existsSync(`${this.databasePath}.restore.json`)) {
      this.invalidate(ownership);
      recoverInterruptedRestore(this.databasePath);
    }
  }

  initialize(): void {
    let ownership: Database.Database | undefined;
    try {
      ownership = this.openOwnership();
      ownership.exec("BEGIN IMMEDIATE");
      this.recover(ownership);
      ownership.exec("COMMIT");
    } catch (error) {
      // Another backend may be completing a query at startup. Its lease is never
      // stolen; the first query waits and performs any pending crash recovery.
      if (!(error instanceof Error) || !("code" in error) || error.code !== "SQLITE_BUSY") throw error;
    } finally { ownership?.close(); }
  }

  async exclusive<T>(operation: (ownership: Database.Database) => Promise<T>, wait = true): Promise<T> {
    // Interactive and batch transactions hold one lease for their entire lifetime.
    if (this.context.getStore()) throw new Error("Nested database maintenance ownership is not allowed.");
    const deadline = Date.now() + 10_000;
    let ownership: Database.Database;
    while (true) {
      try {
        ownership = this.openOwnership();
        try { ownership.exec("BEGIN IMMEDIATE"); } catch (error) { ownership.close(); throw error; }
        break;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "SQLITE_BUSY") throw error;
        if (!wait || Date.now() >= deadline) throw new DatabaseMaintenanceError();
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      // A crashed owner releases the SQLite lock; its journal is recovered by the next lease.
      this.recover(ownership);
      const result = await this.context.run(true, () => operation(ownership));
      ownership.exec("COMMIT");
      return result;
    } catch (error) {
      // Ownership releases on both successful and failed operations.
      ownership.exec("COMMIT");
      throw error;
    } finally { ownership.close(); }
  }

  async query<T>(operation: (ownership?: Database.Database) => Promise<T>): Promise<T> {
    if (this.context.getStore()) return operation();
    return this.exclusive(operation);
  }
}
