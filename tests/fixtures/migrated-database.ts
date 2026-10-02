import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";

export function migrationNames() { return readdirSync(resolve("prisma/migrations")).filter((name) => /^\d/.test(name)).sort(); }
export const PRE_REPAIR_MIGRATION = "20260817000000_folder_last_activity";
export function createMigratedDatabase(filename: string, lastMigration?: string) {
  const db = new Database(filename);
  db.exec("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT current_timestamp, applied_steps_count INTEGER NOT NULL DEFAULT 0)");
  const names = migrationNames();
  const cutoff = lastMigration ? names.indexOf(lastMigration) : names.length - 1;
  if (cutoff < 0) throw new Error("Unknown fixture migration cutoff");
  for (const name of names.slice(0, cutoff + 1)) {
    const sql = readFileSync(join(resolve("prisma/migrations"), name, "migration.sql"), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES(?,?,CURRENT_TIMESTAMP,?,1)").run(randomUUID(), createHash("sha256").update(sql).digest("hex"), name);
  }
  return db;
}

export function seedLegacyAcceptance(db: Database.Database) {
  const timestamp = "2026-08-15T12:34:56.000Z";
  db.prepare("INSERT INTO BookmarkFolder(id,name,updatedAt,lastFetchedAt,lastProcessedAt) VALUES(?,?,?,?,?)").run("x-folder", "Human folder", timestamp, timestamp, timestamp);
  db.prepare("INSERT INTO BookmarkFolder(id,name,updatedAt) VALUES(?,?,?)").run("yt:pl:playlist-one", "First playlist", timestamp);
  db.prepare("INSERT INTO BookmarkFolder(id,name,updatedAt) VALUES(?,?,?)").run("yt:pl:playlist-two", "Second playlist", timestamp);
  const insert = db.prepare("INSERT INTO Bookmark(id,source,tweetUrl,text,folderId,rawJson,summary,category,tags,readAt,editedAt,summarizedAt,embedding,mediaJson,mediaDescription) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insert.run("agent-stable-id", "x", "https://x.test/status/agent-stable-id", "Original authored post", "x-folder", JSON.stringify({ id: "agent-stable-id", author_id: "fixture-author" }), "Manually corrected summary", "Human category", "human,verified", timestamp, timestamp, timestamp, Buffer.from(new Float32Array([1, 0]).buffer), JSON.stringify([{ type: "photo" }]), "Retained image description");
  for (const playlist of ["playlist-one", "playlist-two"]) insert.run(`yt:${playlist}:same-video`, "yt", "https://www.youtube.com/watch?v=same-video", "Playlist video description", `yt:pl:${playlist}`, JSON.stringify({ playlistId: playlist, item: { snippet: { resourceId: { videoId: "same-video" }, videoOwnerChannelTitle: "Uploader", videoOwnerChannelId: "uploader", publishedAt: timestamp }, contentDetails: { videoPublishedAt: "2020-01-01T00:00:00.000Z" } } }), "Human video summary", "Science", "video,manual", timestamp, timestamp, timestamp, null, null, null);
  db.prepare("INSERT INTO Settings(id,updatedAt,llmModel,llmEmbeddingModel,llmEmbeddingBaseUrl,llmApiKey,llmSystemPrompt,xUserId,xAccessToken,xRefreshToken,ytClientId,ytClientSecret,ytAccessToken,ytRefreshToken,monthlyCap,ytMonthlyCap,targetLanguage,lastBookmarkId,lastSyncedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("default", timestamp, "synthetic-chat", "synthetic-embedding", "http://127.0.0.1:1/v1", "fixture-only-key", "Human prompt", "fixture-account", "fixture-x-access", "fixture-x-refresh", "fixture-google-client", "fixture-google-secret", "fixture-yt-access", "fixture-yt-refresh", 321, 654, "Italian", "agent-stable-id", timestamp);
  db.prepare("INSERT INTO OperationRun(id,type,status,total,processed,updated,finishedAt,notes,configJson) VALUES(?,?,?,?,?,?,?,?,?)").run("agent-stable-run", "agent", "completed", 3, 3, 3, timestamp, "Human operation notes", JSON.stringify({ selectedIds: ["agent-stable-id", "yt:playlist-one:same-video", "yt:playlist-two:same-video"] }));
  db.prepare("INSERT INTO ProcessingEvent(id,runId,bookmarkId,type,status,message,metadataJson) VALUES(?,?,?,?,?,?,?)").run("stable-event", "agent-stable-run", "agent-stable-id", "enrich", "completed", "Historical event", JSON.stringify({ bookmarkId: "agent-stable-id" }));
  db.prepare("INSERT INTO LlmRequestLog(id,runId,bookmarkId,model,prompt,response,parsedJson,durationMs,tokenUsageJson) VALUES(?,?,?,?,?,?,?,?,?)").run("stable-log", "agent-stable-run", "agent-stable-id", "fixture-model", "Historical prompt", "Historical response", JSON.stringify({ summary: "Historical summary" }), 123, JSON.stringify({ total_tokens: 25 }));
  db.prepare("INSERT INTO ImportRun(id,finishedAt,totalFetched,notes) VALUES(?,?,?,?)").run("stable-import", timestamp, 3, "Historical import");
  db.prepare("INSERT INTO UsageMonth(id,month,source,usedBookmarks,updatedAt) VALUES(?,?,?,?,?)").run("2026-08:x", "2026-08", "x", 15, timestamp);
  db.prepare("INSERT INTO OAuthSession(state,codeVerifier,createdAt) VALUES(?,?,?)").run("historical-session-id", "historical-verifier", timestamp);
}

const preservedTables = ["Bookmark", "BookmarkFolder", "Settings", "OperationRun", "ProcessingEvent", "LlmRequestLog", "ImportRun", "UsageMonth", "OAuthSession"] as const;
const columnSchema = z.array(z.object({ name: z.string() }));
export function databaseRows(db: Database.Database, columns?: Record<string, string[]>) {
  const snapshot: Record<string, unknown[]> = {}; const selected: Record<string, string[]> = {};
  for (const table of preservedTables) {
    selected[table] = columns?.[table] ?? columnSchema.parse(db.prepare(`PRAGMA table_info("${table}")`).all()).map((entry) => entry.name);
    const fields = selected[table].map((column) => `"${column.replaceAll('"', '""')}"`).join(",");
    snapshot[table] = db.prepare(`SELECT ${fields} FROM "${table}" ORDER BY 1`).all();
  }
  return { columns: selected, rows: snapshot };
}
