// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { prisma } from "@/lib/db";
import { indexedFixture } from "../fixtures/embedding";
import { getDashboardStats } from "@/app/lib/dashboard-fetcher";
import { getBookmarks } from "@/lib/bookmarks";
import { getEffectiveEmbeddingIdentity } from "@/lib/llm";
const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", () => {
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-dashboard-")); const file = join(fixture.directory, "fixture.db"); const db = new Database(file);
  const migrations = join(process.cwd(), "prisma/migrations"); for (const name of readdirSync(migrations).filter((entry) => /^\d/.test(entry)).sort()) db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8")); db.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: file }) }) };
});
vi.mock("@/lib/llm", () => ({ getEffectiveEmbeddingIdentity: vi.fn(async () => ({ model: "fixture-model", endpoint: "http://localhost:1234/v1" })) }));
vi.mock("@/lib/x", () => ({ fetchXUsage: vi.fn() }));
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });
beforeAll(async () => {
  const current = indexedFixture({ id: "current", source: "yt", summary: "Current source", embedding: Buffer.from(new Float32Array([1, 0]).buffer) });
  await prisma.bookmark.createMany({ data: [current, { id: "pending", source: "yt" }, { id: "failed", source: "yt", enrichmentError: "503" }, { id: "blocked", source: "yt", enrichmentFailures: 3, enrichmentError: "Missing source" }, { id: "missing", source: "yt", summary: "Needs vector" }, { ...current, id: "stale", summary: "Changed source" }, { id: "other", source: "x", summary: "X only" }, { id: "unknown", source: "agent" }].map((row) => ({ ...row, tweetUrl: `https://example.com/${row.id}` })) });
  await prisma.operationRun.createMany({ data: [
    { id: "yt-import", type: "youtube_playlist_import", source: "yt", processed: 4, startedAt: new Date("2026-02-01") },
    { id: "x-import", type: "x_sync", source: "x", processed: 1, startedAt: new Date("2026-03-01") },
    { id: "yt-enrich", type: "enrichment", source: "yt", processed: 1, startedAt: new Date("2026-04-01") },
    { id: "failed-import", type: "youtube_sync", source: "yt", processed: 0, startedAt: new Date("2026-05-01"), status: "failed" },
  ] });
});
describe("dashboard/library state agreement", () => {
  it("counts the entire selected source, partitions index health and uses source-specific import activity", async () => {
    const stats = await getDashboardStats("yt"); expect(stats).toMatchObject({ total: 6, summarized: 3, pending: 3, failedItemsCount: 2, skippedItemsCount: 1, lastRun: { id: "yt-import" }, indexHealth: { withEmbedding: 1, missing: 1, stale: 1, unindexed: 2 } });
    expect(stats.recent.every((row) => row.source === "yt")).toBe(true); expect((await getDashboardStats("x")).lastRun?.id).toBe("x-import");
  });
  it("keeps dashboard and repair filters usable when saved model configuration is invalid", async () => {
    vi.mocked(getEffectiveEmbeddingIdentity).mockRejectedValue(new Error("Invalid saved model endpoint"));
    try {
      const stats = await getDashboardStats("yt");
      expect(stats).toMatchObject({ total: 6, indexHealth: { withEmbedding: 0, stale: 2, unindexed: 3 } });
      expect((await getBookmarks({ source: "yt", status: "unindexed" })).total).toBe(3);
      expect((await getBookmarks({ source: "yt", status: "stale" })).total).toBe(2);
    } finally { vi.mocked(getEffectiveEmbeddingIdentity).mockResolvedValue({ model: "fixture-model", endpoint: "http://localhost:1234/v1" }); }
  });
  it("dashboard links use exactly the same state predicates as library queries", async () => {
    const stats = await getDashboardStats("yt");
    for (const [status, count] of [["pending", stats.pending], ["summarized", stats.summarized], ["failed", stats.failedItemsCount], ["blocked", stats.skippedItemsCount], ["stale", stats.indexHealth.stale], ["unindexed", stats.indexHealth.unindexed]] satisfies Array<["pending" | "summarized" | "failed" | "blocked" | "stale" | "unindexed", number]>) {
      expect((await getBookmarks({ source: "yt", status })).total).toBe(count);
    }
    expect((await getBookmarks({ source: "yt", status: "unread" })).total).toBe(6);
  });
});
