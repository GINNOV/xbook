import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tableExists(database: Database.Database, name: string) {
  const row = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

/** Consistent snapshot, including committed WAL pages. Credentials are omitted unless requested. */
export async function createDatabaseExport(dbPath: string, includeSecrets = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-export-"));
  const snapshotPath = path.join(directory, "export.db");
  try {
    const source = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      await source.backup(snapshotPath);
    } finally {
      source.close();
    }

    const snapshot = new Database(snapshotPath);
    try {
      snapshot.pragma("journal_mode = DELETE");
      snapshot.pragma("secure_delete = ON");
      if (!includeSecrets && tableExists(snapshot, "Settings")) {
        snapshot.exec(`
          UPDATE Settings SET
            xBearerToken = NULL, xClientSecret = NULL,
            xAccessToken = NULL, xRefreshToken = NULL,
            xTokenExpiresAt = NULL, xScope = NULL, xTokenType = NULL,
            ytClientSecret = NULL, ytAccessToken = NULL, ytRefreshToken = NULL,
            ytTokenExpiresAt = NULL, ytScope = NULL, ytTokenType = NULL,
            llmApiKey = NULL;
        `);
      }
      if (tableExists(snapshot, "OAuthSession")) {
        snapshot.exec("DELETE FROM OAuthSession");
      }
      snapshot.exec("VACUUM");
    } finally {
      snapshot.close();
    }
    return fs.readFileSync(snapshotPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
