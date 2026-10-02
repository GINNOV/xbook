// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedFixture } from "../fixtures/embedding";
import { prisma } from "@/lib/db";
import { getBookmarks } from "@/lib/bookmarks";
import { getBookmarksPageData } from "@/app/lib/bookmarks-fetcher";
import { normalizeBookmarkPagination } from "@/lib/bookmark-pagination";
import { generateEmbedding } from "@/lib/llm";
import { rmSync } from "node:fs";

const fixture = vi.hoisted(() => ({ directory: "" }));

vi.mock("@/lib/db", async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-v4-pagination-"));
  const path = join(fixture.directory, "fixture.db");
  const connection = new Database(path);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    connection.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  connection.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: path }) }) };
});

vi.mock("@/lib/llm", () => {
  const generateEmbedding = vi.fn();
  return {
    generateEmbedding,
    generateEmbeddingResult: async (text: string) => ({ vector: await generateEmbedding(text), identity: { model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 } }),
    getEffectiveEmbeddingIdentity: async () => ({ model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 }),
  };
});

const vector = (values: number[]) => Buffer.from(new Float32Array(values).buffer);



beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.bookmark.deleteMany();
  vi.mocked(generateEmbedding).mockResolvedValue([1, 0]);
  await prisma.bookmark.createMany({ data: Array.from({ length: 3 }, (_, i) => ({
    id: `row-${i}`, source: "x", tweetUrl: `https://x.com/${i}`, summary: "query",
    importedAt: new Date(`2026-01-0${i + 1}`), embedding: vector([1, i]),
  })).map(indexedFixture) });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(fixture.directory, { recursive: true, force: true });
});

const base = { query: "query", source: "x", page: 1, pageSize: 2 };

describe("effective pagination with real SQLite", () => {
  it.each(["bad", "NaN", "Infinity", "-Infinity", "", 0, -1, 1.5, NaN, Infinity, null, undefined])("normalizes invalid page %s to one", async (page) => {
    const result = await getBookmarks({ ...base, page });
    expect(result.page).toBe(1);
    expect(result.bookmarks.map((row) => row.id)).toEqual(["row-2", "row-1"]);
  });

  it.each(["bad", "NaN", "Infinity", "-Infinity", "", 0, -1, 1.5, NaN, Infinity, null, undefined])("normalizes invalid pageSize %s to default fifty", async (pageSize) => {
    const result = await getBookmarks({ ...base, pageSize });
    expect(result.pageSize).toBe(50);
    expect(result.bookmarks).toHaveLength(3);
  });

  it("caps valid large sizes and accepts positive integer strings", () => {
    expect(normalizeBookmarkPagination("2", "999")).toEqual({ page: 2, pageSize: 200 });
    expect(normalizeBookmarkPagination("3", "1")).toEqual({ page: 3, pageSize: 1 });
  });

  it("clamps before fetching keyword results and reports fetched page", async () => {
    const result = await getBookmarks({ ...base, page: 999999 });
    expect(result.page).toBe(2);
    expect(result.total).toBe(3);
    expect(result.bookmarks.map((row) => row.id)).toEqual(["row-0"]);
  });

  it("clamps semantic results after ranking and retains relevance", async () => {
    const result = await getBookmarks({ ...base, semantic: true, page: Infinity });
    expect(result.page).toBe(1);
    expect(result.bookmarks.map((row) => row.id)).toEqual(["row-0", "row-1"]);
    const last = await getBookmarks({ ...base, semantic: true, page: 999999 });
    expect(last.page).toBe(2);
    expect(last.bookmarks.map((row) => row.id)).toEqual(["row-2"]);
  });

  it.each([false, true])("returns page one for empty result semantic=%s", async (semantic) => {
    const result = await getBookmarks({ ...base, semantic, source: "yt", page: 999 });
    expect(result).toMatchObject({ page: 1, total: 0, pageSize: 2, bookmarks: [] });
  });

  it("library reports the same effective page it fetched", async () => {
    const result = await getBookmarksPageData({ source: "x", page: "999" }, 2);
    expect(result.currentPage).toBe(2);
    expect(result.pg).toBe(2);
    expect(result.totalPages).toBe(2);
    expect(result.data.bookmarks.map((row) => row.id)).toEqual(["row-0"]);
    const defaultSize = await getBookmarksPageData({ source: "x", page: "1.5" }, 100);
    expect(defaultSize.currentPage).toBe(1);
    expect(defaultSize.data.pageSize).toBe(100);
  });
});
