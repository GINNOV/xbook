// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedFixture } from "../fixtures/embedding";
import { prisma } from "@/lib/db";
import { getBookmarks } from "@/lib/bookmarks";
import { getBookmarksPageData } from "@/app/lib/bookmarks-fetcher";
import { generateEmbedding } from "@/lib/llm";
import { rmSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterControls } from "@/app/components/bookmarks/FilterControls";

const fixture = vi.hoisted(() => ({ directory: "", search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(fixture.search),
}));

vi.mock("@/lib/db", async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-v4-relevance-"));
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
  return ({
    generateEmbeddingResult: async (text: string, signal?: AbortSignal) => ({
      vector: await generateEmbedding(text, signal),
      identity: { model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 },
    }),
    getEffectiveEmbeddingIdentity: async () => ({ model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 }),

  generateEmbedding,
});
});

const vector = (values: number[]) => Buffer.from(new Float32Array(values).buffer);


beforeEach(async () => {
  vi.clearAllMocks();
  fixture.search = "";
  await prisma.bookmark.deleteMany();
  vi.mocked(generateEmbedding).mockResolvedValue([1, 0]);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(fixture.directory, { recursive: true, force: true });
});

async function seed() {
  await prisma.bookmark.createMany({ data: [
    { id: "a-best", summary: "Zebra relevance", authorUsername: "zed", embedding: vector([1, 0]), importedAt: new Date("2026-01-01") },
    { id: "b-mid", summary: "Middle relevance", authorUsername: "mid", embedding: vector([0.8, 0.6]), importedAt: new Date("2026-02-01") },
    { id: "c-new", summary: "Alpha relevance", authorUsername: "abc", embedding: vector([0, 1]), importedAt: new Date("2026-03-01") },
  ].map((row) => indexedFixture({ ...row, source: "yt", tweetUrl: `https://youtube.com/watch?v=${row.id}` })) });
}

const request = { query: "relevance", semantic: true, source: "yt", page: 1, pageSize: 2 };
const ids = (result: Awaited<ReturnType<typeof getBookmarks>>) => result.bookmarks.map((row) => row.id);

describe("semantic relevance defaults across library paths", () => {
  it("keeps similarity order and paginates after ranking", async () => {
    await seed();
    expect(ids(await getBookmarks(request))).toEqual(["a-best", "b-mid"]);
    const next = await getBookmarks({ ...request, page: 2 });
    expect(ids(next)).toEqual(["c-new"]);
    expect(next.total).toBe(3);
    expect(next.bookmarks[0].similarity).toBe(0);
  });

  it("preserves explicit import, summary and author sorts", async () => {
    await seed();
    expect(ids(await getBookmarks({ ...request, sort: "import", dir: "desc" }))).toEqual(["c-new", "b-mid"]);
    expect(ids(await getBookmarks({ ...request, sort: "summary", dir: "asc" }))).toEqual(["c-new", "b-mid"]);
    expect(ids(await getBookmarks({ ...request, sort: "author", dir: "desc" }))).toEqual(["a-best", "b-mid"]);
    expect(ids(await getBookmarks({ ...request, sort: "relevance", dir: "asc" }))).toEqual(["c-new", "b-mid"]);
  });

  it("keeps keyword and empty semantic queries newest import first", async () => {
    await seed();
    expect(ids(await getBookmarks({ ...request, semantic: false }))).toEqual(["c-new", "b-mid"]);
    expect(ids(await getBookmarks({ ...request, query: "" }))).toEqual(["c-new", "b-mid"]);
  });

  it("does not turn a library default into an explicit import override", async () => {
    await seed();
    const page = await getBookmarksPageData({ q: "relevance", semantic: "true", source: "yt" }, 2);
    expect(page.sort).toBe("relevance");
    expect(ids(page.data)).toEqual(["a-best", "b-mid"]);
    const explicit = await getBookmarksPageData({ q: "relevance", semantic: "true", source: "yt", sort: "import" }, 2);
    expect(ids(explicit.data)).toEqual(["c-new", "b-mid"]);
  });

  it("uses deterministic IDs for ties before scoped top50 and pagination", async () => {
    await prisma.bookmark.createMany({ data: [
      ...Array.from({ length: 55 }, (_, i) => ({ id: `x-${i}`, source: "x", embedding: vector([1, 0]) })),
      ...Array.from({ length: 52 }, (_, i) => ({ id: `yt-${String(51 - i).padStart(2, "0")}`, source: "yt", embedding: vector([0.8, 0.6]) })),
    ].map((row) => indexedFixture({ ...row, tweetUrl: `https://example.com/${row.id}`, summary: "relevance" })) });
    const first = await getBookmarks({ ...request, pageSize: 25 });
    const second = await getBookmarks({ ...request, pageSize: 25, page: 2 });
    expect(first.total).toBe(50);
    expect(ids(first)).toEqual(Array.from({ length: 25 }, (_, i) => `yt-${String(i).padStart(2, "0")}`));
    expect(ids(second)).toEqual(Array.from({ length: 25 }, (_, i) => `yt-${String(i + 25).padStart(2, "0")}`));
  });

  it("omits implicit sort hidden fields in semantic search controls", () => {
    const html = renderToStaticMarkup(createElement(FilterControls, {
      categories: [], folders: [], counts: { total: 0, pending: 0, summarized: 0, uncategorized: 0, noFolder: 0, videos: 0 },
      q: "", source: "", category: "", status: "", video: false, semantic: true, folderId: "", sort: "import", dir: "desc",
    }));
    expect(html).toContain('name="semantic"');
    expect(html).not.toContain('name="sort"');
    expect(html).not.toContain('name="dir"');
  });

  it("preserves intentionally selected sort in semantic GET fields", () => {
    fixture.search = "sort=import&dir=asc";
    const html = renderToStaticMarkup(createElement(FilterControls, {
      categories: [], folders: [], counts: { total: 0, pending: 0, summarized: 0, uncategorized: 0, noFolder: 0, videos: 0 },
      q: "", source: "", category: "", status: "", video: false, semantic: true, folderId: "", sort: "import", dir: "asc",
    }));
    expect(html).toContain('name="sort" value="import"');
    expect(html).toContain('name="dir" value="asc"');
  });
});
