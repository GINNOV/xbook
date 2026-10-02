import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Take a consistent snapshot, including committed writes still in SQLite's WAL. */
export async function createDatabaseExport(dbPath: string, includeSecrets = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xbook-export-"));
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
      if (!includeSecrets) {
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
      // Pending OAuth verifiers should never move to another installation.
      snapshot.exec("DELETE FROM OAuthSession");
      // Rebuild pages so deleted credentials cannot survive in free space.
      snapshot.exec("VACUUM");
    } finally {
      snapshot.close();
    }
    return await fs.readFile(snapshotPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
