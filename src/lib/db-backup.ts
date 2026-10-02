import path from "path";
import fs from "fs";
import os from "os";
import Database from "better-sqlite3";
import { prisma } from "@/lib/db";
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
  replaceActiveDatabase,
  RestoreRejectedError,
  type RestoreFailurePoint,
} from "@/lib/restore-safety";

/**
 * Returns the absolute filesystem path to the active SQLite database file.
 */
export function getDbPath(): string {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  let sqlitePath = databaseUrl.startsWith("file:")
    ? databaseUrl.slice("file:".length)
    : databaseUrl;
  if (!path.isAbsolute(sqlitePath)) {
    sqlitePath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), sqlitePath);
  }
  return sqlitePath;
}

/**
 * Returns the directory path where local database backups are stored,
 * creating it if it doesn't already exist.
 */
export function getBackupDir(): string {
  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);
  const backupDir = path.join(dbDir, "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
}

/**
 * Lists all database backup files stored in the backups directory.
 */
export function listBackups() {
  const backupDir = getBackupDir();
  const files = fs.readdirSync(backupDir);
  return files
    .filter((f) => f.endsWith(".db") || f.endsWith(".sqlite"))
    .map((f) => {
      const p = path.join(backupDir, f);
      const stat = fs.statSync(p);
      return {
        filename: f,
        size: stat.size,
        createdAt: stat.birthtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function writeDatabaseSnapshot(destination: string): Promise<void> {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error("Active database file not found.");
  }
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
    const snapshot = new Database(destination, { fileMustExist: true });
    try {
      // Export a standalone database that does not create WAL sidecars on reopen.
      snapshot.pragma("journal_mode = DELETE");
    } finally {
      snapshot.close();
    }
    fs.chmodSync(destination, 0o600);
  } finally {
    source.close();
  }
}

export class BackupAlreadyExistsError extends Error {
  constructor() {
    super("A backup with this name already exists.");
    this.name = "BackupAlreadyExistsError";
  }
}

/** Returns an online SQLite snapshot, including committed WAL data. */
export async function readDatabaseSnapshot(): Promise<Buffer> {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-db-download-"));
  try {
    const snapshotPath = path.join(temporaryDir, "snapshot.db");
    await writeDatabaseSnapshot(snapshotPath);
    return fs.readFileSync(snapshotPath);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

/** Publishes a complete SQLite snapshot without replacing an existing backup. */
export async function createBackup(customName?: string) {
  const backupDir = getBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  
  let filename = `backup_${timestamp}.db`;
  if (customName) {
    const sanitized = customName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (sanitized.length > 0) {
      filename = `${sanitized}.db`;
    }
  }
  
  const destPath = path.join(backupDir, filename);
  const temporaryDir = fs.mkdtempSync(path.join(backupDir, ".snapshot-"));
  try {
    const snapshotPath = path.join(temporaryDir, "snapshot.db");
    await writeDatabaseSnapshot(snapshotPath);
    try {
      // A hard link publishes the completed file atomically and rejects collisions.
      fs.linkSync(snapshotPath, destPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new BackupAlreadyExistsError();
      }
      throw error;
    }
    return { filename, path: destPath };
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

/**
 * Deletes a local backup file from the server.
 */
export function deleteBackup(filename: string): boolean {
  const backupDir = getBackupDir();
  const targetPath = path.join(backupDir, filename);

  // Security check: ensure targetPath is within backupDir (prevent directory traversal)
  const relative = path.relative(backupDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid backup file path.");
  }

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
    return true;
  }
  return false;
}

/**
 * Validates a staged copy, snapshots the active database, swaps, then reconnects.
 * A failure before commit restores the snapshot. The active file is not deleted first.
 */
export async function restoreBackup(
  backupPath: string,
  options: { failAt?: RestoreFailurePoint } = {},
): Promise<boolean> {
  const dbPath = getDbPath();
  if (!fs.existsSync(backupPath)) {
    throw new RestoreRejectedError("Backup file to restore not found.");
  }
  const lock = acquireMaintenanceLock(dbPath);
  try {
    await prisma.$disconnect();
    await replaceActiveDatabase({
      databasePath: dbPath,
      candidatePath: backupPath,
      migrationsDir: path.join(process.cwd(), "prisma", "migrations"),
      failAt: options.failAt,
      reconnect: async () => {
        await prisma.$connect();
      },
    });
    return true;
  } catch (error) {
    const { recoverRestoreJournal } = await import("@/lib/restore-safety");
    recoverRestoreJournal(dbPath);
    await Promise.resolve(prisma.$connect?.()).catch(() => undefined);
    throw error;
  } finally {
    releaseMaintenanceLock(lock);
  }
}

/**
 * Clears bookmarks, folders, runs and logs but preserves application settings.
 */
export async function clearDatabaseData(): Promise<boolean> {
  // Clear records in dependency order
  await prisma.$transaction([
    prisma.llmRequestLog.deleteMany(),
    prisma.processingEvent.deleteMany(),
    prisma.bookmark.deleteMany(),
    prisma.bookmarkFolder.deleteMany(),
    prisma.operationRun.deleteMany(),
    prisma.importRun.deleteMany(),
    prisma.usageMonth.deleteMany(),
    prisma.oAuthSession.deleteMany(),
  ]);
  return true;
}
