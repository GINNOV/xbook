import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export class RestoreRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreRejectedError";
  }
}

export type RestoreFailurePoint = "swap" | "reconnect";

function journalPath(databasePath: string) {
  return `${databasePath}.restore.json`;
}

function recoveryName(databasePath: string) {
  return `${path.basename(databasePath)}.recovery`;
}

export function removeDatabaseSidecars(databasePath: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function syncFile(filename: string) {
  const descriptor = fs.openSync(filename, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

type Journal = { version: 1; recovery: string; stage: "prepared" | "replaced" | "committed" };

function readJournal(databasePath: string): Journal | null {
  const filename = journalPath(databasePath);
  if (!fs.existsSync(filename)) return null;
  const parsed = JSON.parse(fs.readFileSync(filename, "utf8")) as Journal;
  if (parsed.version !== 1 || !parsed.recovery || !parsed.stage) {
    throw new RestoreRejectedError("Restore journal is unreadable.");
  }
  const directory = path.dirname(databasePath);
  if (path.dirname(parsed.recovery) !== directory || path.basename(parsed.recovery) !== recoveryName(databasePath)) {
    throw new RestoreRejectedError("Restore journal points outside the database directory.");
  }
  return parsed;
}

function writeJournal(databasePath: string, stage: Journal["stage"]) {
  const recovery = path.join(path.dirname(databasePath), recoveryName(databasePath));
  const temporary = `${journalPath(databasePath)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, recovery, stage }), { mode: 0o600 });
  syncFile(temporary);
  fs.renameSync(temporary, journalPath(databasePath));
}

function rollbackFromRecovery(databasePath: string, recovery: string) {
  if (!fs.existsSync(recovery)) throw new RestoreRejectedError("Restore recovery snapshot is missing.");
  const snapshot = new Database(recovery, { readonly: true, fileMustExist: true });
  try {
    if (snapshot.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new RestoreRejectedError("Restore recovery snapshot failed integrity check.");
    }
  } finally {
    snapshot.close();
  }
  const replacement = `${databasePath}.rollback`;
  fs.copyFileSync(recovery, replacement);
  syncFile(replacement);
  removeDatabaseSidecars(databasePath);
  fs.renameSync(replacement, databasePath);
}

/** Finish or undo a restore that died between the snapshot and a confirmed reconnect. */
export function recoverRestoreJournal(databasePath: string): boolean {
  const journal = readJournal(databasePath);
  if (!journal) return false;
  // "prepared" means the active file has not been replaced yet.
  if (journal.stage === "replaced") rollbackFromRecovery(databasePath, journal.recovery);
  fs.rmSync(journalPath(databasePath), { force: true });
  fs.rmSync(journal.recovery, { force: true });
  return true;
}

export function validateRestoreCandidate(candidatePath: string, migrationsDir: string) {
  let database: Database.Database;
  try {
    database = new Database(candidatePath, { readonly: true, fileMustExist: true });
  } catch {
    throw new RestoreRejectedError("Backup is not a readable SQLite database.");
  }
  try {
    if (database.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new RestoreRejectedError("Backup failed integrity check.");
    }
    const names = new Set(
      (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    );
    for (const required of ["Bookmark", "Settings"]) {
      if (!names.has(required)) throw new RestoreRejectedError(`Backup is incompatible: missing ${required}.`);
    }
    if (names.has("_prisma_migrations")) {
      const known = new Set(fs.readdirSync(migrationsDir));
      const applied = database.prepare("SELECT migration_name FROM _prisma_migrations").all() as {
        migration_name: string;
      }[];
      for (const row of applied) {
        if (!known.has(row.migration_name)) {
          throw new RestoreRejectedError(`Backup is incompatible: unknown migration ${row.migration_name}.`);
        }
      }
    }
  } finally {
    database.close();
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireMaintenanceLock(databasePath: string) {
  const lockPath = `${databasePath}.maintenance.lock`;
  try {
    const descriptor = fs.openSync(lockPath, "wx");
    fs.writeFileSync(descriptor, String(process.pid));
    fs.closeSync(descriptor);
    return lockPath;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const recorded = Number(fs.readFileSync(lockPath, "utf8"));
    if (Number.isInteger(recorded) && recorded > 0 && processIsAlive(recorded)) {
      throw new RestoreRejectedError("Restore cannot run while another maintenance operation holds the database.");
    }
    fs.rmSync(lockPath, { force: true });
    return acquireMaintenanceLock(databasePath);
  }
}

export function releaseMaintenanceLock(lockPath: string) {
  fs.rmSync(lockPath, { force: true });
}

export function assertNoActiveProcessing(databasePath: string) {
  if (!fs.existsSync(databasePath)) return;
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const table = database
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'OperationRun'")
      .get();
    if (!table) return;
    const row = database
      .prepare("SELECT COUNT(*) AS n FROM OperationRun WHERE status IN ('queued', 'running')")
      .get() as { n: number };
    if (row.n > 0) {
      throw new RestoreRejectedError("Restore cannot run while processing is active.");
    }
  } finally {
    database.close();
  }
}

export async function snapshotDatabase(sourcePath: string, destination: string) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
  const snapshot = new Database(destination, { fileMustExist: true });
  try {
    snapshot.pragma("journal_mode = DELETE");
  } finally {
    snapshot.close();
  }
  fs.chmodSync(destination, 0o600);
}

export async function replaceActiveDatabase(options: {
  databasePath: string;
  candidatePath: string;
  migrationsDir: string;
  failAt?: RestoreFailurePoint;
  reconnect?: () => Promise<void>;
}) {
  const { databasePath, candidatePath } = options;
  validateRestoreCandidate(candidatePath, options.migrationsDir);
  assertNoActiveProcessing(databasePath);
  const directory = path.dirname(databasePath);
  const recovery = path.join(directory, recoveryName(databasePath));
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(databasePath)) await snapshotDatabase(databasePath, recovery);
  else fs.copyFileSync(candidatePath, recovery);
  writeJournal(databasePath, "prepared");

  if (options.failAt === "swap") throw new Error("Injected swap failure.");

  const incoming = `${databasePath}.incoming`;
  fs.copyFileSync(candidatePath, incoming);
  syncFile(incoming);
  removeDatabaseSidecars(databasePath);
  if (fs.existsSync(databasePath)) fs.rmSync(databasePath);
  fs.renameSync(incoming, databasePath);
  writeJournal(databasePath, "replaced");

  if (options.failAt === "reconnect") throw new Error("Injected reconnect failure.");
  if (options.reconnect) await options.reconnect();
  writeJournal(databasePath, "committed");
  recoverRestoreJournal(databasePath);
}
