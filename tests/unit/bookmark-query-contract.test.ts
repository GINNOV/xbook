// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedFixture } from "../fixtures/embedding";
import { prisma } from "@/lib/db";
import { getBookmarks } from "@/lib/bookmarks";
import { getBookmarksPageData, buildPageHref } from "@/app/lib/bookmarks-fetcher";
import { bookmarkQuerySchema } from "@/lib/bookmark-query";
import { POST as submit_sync } from "@/app/api/bookmarks/embeddings/sync/route";
import { GET as agentGet } from "@/app/api/agent/route";
import BookmarksPage from "@/app/bookmarks/page";
import { generateEmbedding } from "@/lib/llm";
import { rmSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/components/BookmarksList", () => ({ default: () => null }));
vi.mock("@/app/components/bookmarks/PaginationControls", () => ({ PaginationControls: () => null }));
const fixture = vi.hoisted(() => ({ directory: "", search: "", identityModel: "fixture-model" }));

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
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-r2-query-"));
  const path = join(fixture.directory, "fixture.db");
  const connection = new Database(path);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    connection.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  connection.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: path }) }) };
});

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  const generateEmbedding = vi.fn();
  return ({
    ...actual,
    generateEmbeddingResult: async (text: string, signal?: AbortSignal) => ({
      vector: await generateEmbedding(text, signal),
      identity: { model: fixture.identityModel, endpoint: "http://localhost:1234/v1", dimensions: 2 },
    }),
    getEffectiveEmbeddingIdentity: async () => ({ model: fixture.identityModel, endpoint: "http://localhost:1234/v1", dimensions: 2 }),

  generateEmbedding,
});
});

const vector = (values: number[]) => Buffer.from(new Float32Array(values).buffer);


beforeEach(async () => {
  vi.clearAllMocks();
  fixture.search = "";
  fixture.identityModel = "fixture-model";
  await prisma.processingEvent.deleteMany();
  await prisma.operationRun.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.bookmarkFolder.deleteMany();
  vi.stubEnv("AGENT_API_TOKEN", "");
  vi.mocked(generateEmbedding).mockResolvedValue([1, 0]);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(fixture.directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});


const ids = (result: Awaited<ReturnType<typeof getBookmarks>>) => result.bookmarks.map((row) => row.id);
async function seed() {
  await prisma.bookmarkFolder.createMany({ data: [{ id: "research", name: "Research" }, { id: "other", name: "Other" }] });
  await prisma.bookmark.createMany({ data: [
    { id: "match", source: "agent-private", category: "Models", folderId: "research", text: "Nomic embedding model", tags: "local", summary: null, externalUrls: "https://youtu.be/one", importedAt: new Date("2026-01-01"), embedding: vector([0.8, 0.6]) },
    { id: "substring", source: "agent-private", category: "Models", folderId: "research", text: "Economic embedding model", tags: "local", summary: null, externalUrls: "https://youtu.be/two", importedAt: new Date("2026-02-01"), embedding: vector([1, 0]) },
    { id: "wrong-source", source: "x", category: "Models", folderId: "research", text: "Nomic embedding model", summary: null, externalUrls: "https://youtu.be/three", embedding: vector([1, 0]) },
    { id: "wrong-category", source: "agent-private", category: "Other", folderId: "research", text: "Nomic embedding model", summary: null, externalUrls: "https://youtu.be/four", embedding: vector([1, 0]) },
    { id: "wrong-folder", source: "agent-private", category: "Models", folderId: "other", text: "Nomic embedding model", summary: null, externalUrls: "https://youtu.be/five", embedding: vector([1, 0]) },
    { id: "wrong-status", source: "agent-private", category: "Models", folderId: "research", text: "Nomic embedding model", summary: "Done", externalUrls: "https://youtu.be/six", embedding: vector([1, 0]) },
    { id: "wrong-content", source: "agent-private", category: "Models", folderId: "research", text: "Nomic embedding model", summary: null, embedding: vector([1, 0]) },
  ].map((row) => indexedFixture({ ...row, tweetUrl: `https://example.com/${row.id}` })) });
}
const scope = { source: "agent-private", category: "Models", folderId: "research", status: "pending", video: true };
const parameters = { source: "agent-private", category: "Models", folderId: "research", status: "pending", video: "true" };
const request = (parameters: Record<string, string>) => new Request(`http://localhost/api/agent?${new URLSearchParams({ resource: "bookmarks", ...parameters })}`, { headers: { host: "localhost" } });

describe("shared query contract through SQLite, Library and agent GET", () => {
  it("preserves substring default while exact words excludes economic", async () => {
    await seed();
    expect(ids(await getBookmarks({ ...scope, query: "nomic" }))).toEqual(["substring", "match"]);
    expect(ids(await getBookmarks({ ...scope, query: "nomic", textMode: "word" }))).toEqual(["match"]);
    expect(ids(await getBookmarks({ ...scope, query: "local nomic", textMode: "word" }))).toEqual(["match"]);
  });

  it("matches adjacent ordered whole tokens, ignoring case and punctuation", async () => {
    await seed();
    await prisma.bookmark.update({ where: { id: "match" }, data: { text: "Use NOMİC. Nomic—embedding\nmodel for café research." } });
    expect(ids(await getBookmarks({ ...scope, query: "NOMIC embedding", textMode: "phrase" }))).toEqual(["match"]);
    expect(ids(await getBookmarks({ ...scope, query: "embedding nomic", textMode: "phrase" }))).toEqual([]);
    expect(ids(await getBookmarks({ ...scope, query: "nomic model", textMode: "phrase" }))).toEqual([]);
    expect(ids(await getBookmarks({ ...scope, query: "café", textMode: "word" }))).toEqual(["match"]);
    expect(ids(await getBookmarks({ ...scope, query: "omic", textMode: "phrase" }))).toEqual([]);
  });

  it("matches phrases within one field and words across fields", async () => {
    await seed();
    expect(ids(await getBookmarks({ ...scope, query: "model local", textMode: "phrase" }))).toEqual([]);
    expect(ids(await getBookmarks({ ...scope, query: "model local nomic", textMode: "word" }))).toEqual(["match"]);
    expect(ids(await getBookmarks({ ...scope, query: ".*", textMode: "word" }))).toEqual([]);
  });

  it.each(["substring", "phrase", "word"])("returns identical scoped %s matches through Library and agent GET", async (textMode) => {
    await seed();
    const params = { ...parameters, q: "nomic", textMode, page: "999", pageSize: "1", sort: "author", dir: "asc" };
    const page = await getBookmarksPageData(params, 1);
    const response = await agentGet(request(params));
    const api = await response.json();
    expect(response.status).toBe(200);
    expect(api.bookmarks.map((row: { id: string }) => row.id)).toEqual(ids(page.data));
    expect(api).toMatchObject({ total: page.data.total, page: page.currentPage, pageSize: 1, sort: "author", dir: "asc" });
  });

  it("counts exact results before clamping and fetching the final page", async () => {
    await seed();
    await prisma.bookmark.update({ where: { id: "substring" }, data: { text: "Nomic is economic" } });
    const result = await getBookmarks({ ...scope, query: "nomic", textMode: "word", pageSize: 1, page: 999 });
    expect(result).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(ids(result)).toEqual(["match"]);
  });

  it("applies all structured filters before ranking, ignoring keyword text in semantic mode", async () => {
    await seed();
    const result = await getBookmarks({ ...scope, query: "absent words", semantic: true });
    expect(ids(result)).toEqual(["substring", "match"]);
    expect(result.search).toEqual({ mode: "semantic", fallback: null, limit: 50 });
  });

  it("makes the semantic cap explicit through the agent response", async () => {
    await prisma.bookmark.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
      id: `row-${index}`, source: "agent-private", tweetUrl: `https://example.com/${index}`, summary: "Related", embedding: vector([1, 0]),
    })).map(indexedFixture) });
    const response = await agentGet(request({ q: "unrelated keywords", source: "agent-private", semantic: "true" }));
    const result = await response.json();
    expect(result.total).toBe(50);
    expect(result.bookmarks).toHaveLength(50);
    expect(result.search.limit).toBe(50);
  });

  it("falls back to scoped exact keyword results and newest-first sort when embeddings fail", async () => {
    await seed();
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("Provider rejected private-token"));
    const response = await agentGet(request({ ...parameters, q: "nomic", textMode: "word", semantic: "true", page: "Infinity" }));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.bookmarks.map((row: { id: string }) => row.id)).toEqual(["match"]);
    expect(result).toMatchObject({ total: 1, page: 1, sort: "import", dir: "desc", search: { mode: "keyword", fallback: "embedding_unavailable", limit: null } });
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("preserves intentional keyword sort when falling back", async () => {
    await seed();
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("Unavailable"));
    const data = await getBookmarks({ ...scope, query: "nomic", semantic: true, sort: "import", dir: "asc" });
    expect(ids(data)).toEqual(["match", "substring"]);
    expect(data).toMatchObject({ sort: "import", dir: "asc" });
  });

  it("renders accessible filters and actionable semantic fallback without losing context", async () => {
    await seed();
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("Unavailable"));
    fixture.search = new URLSearchParams({ ...parameters, q: "nomic", semantic: "true", textMode: "word", sort: "author", dir: "asc" }).toString();
    const html = renderToStaticMarkup(await BookmarksPage({ searchParams: Promise.resolve({ ...parameters, q: "nomic", semantic: "true", textMode: "word", sort: "author", dir: "asc" }) }));
    expect(html).toContain("Semantic search is unavailable");
    expect(html).toContain('href="/settings"');
    for (const name of ["Search bookmarks", "Category", "Library state", "Content type", "Folder", "Text matching"]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html).toContain('name="sort" value="author"');
    expect(html).toContain('name="dir" value="asc"');
    expect(html).toContain('name="source" value="agent-private"');
    expect(html).toContain('value="word" selected');
  });

  const invalidParameters: Array<Record<string, string>> = [
    { video: "yes" }, { semantic: "1" }, { status: "not-a-state" }, { textMode: "regex" },
    { source: "x".repeat(33) }, { q: "x".repeat(4001) },
  ];
  it.each(invalidParameters)("rejects malformed API filters %j before querying", async (params) => {
    const response = await agentGet(request(params));
    expect(response.status).toBe(400);
    expect((await response.json()).ok).toBe(false);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("rebuilds incompatible vectors for a changed model and preserves IDs, folders and reading state", async () => {
    await prisma.bookmarkFolder.create({ data: { id: "rebuild-folder", name: "Preserved" } });
    const readAt = new Date("2025-01-01");
    await prisma.bookmark.createMany({ data: [
      { id: "rebuild-a", embedding: vector([1, 0]) },
      { id: "rebuild-b", embedding: vector([0, 1]) },
    ].map((row) => indexedFixture({ ...row, source: "x", tweetUrl: `https://example.com/${row.id}`,
      summary: "Scoped evidence", folderId: "rebuild-folder", readAt })) });
    const query = { query: "evidence", source: "x", folderId: "rebuild-folder", semantic: true };
    expect(ids(await getBookmarks(query))).toEqual(["rebuild-a", "rebuild-b"]);
    fixture.identityModel = "changed-model";
    expect((await getBookmarks(query)).search.fallback).toBe("embedding_unavailable");
    vi.mocked(generateEmbedding).mockResolvedValueOnce([0, 1]).mockResolvedValueOnce([1, 0]);
    const response = await sync(new Request("http://localhost/api/bookmarks/embeddings/sync?source=x&rebuild=true", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 2, failed: 0, remaining: 0 });
    const rows = await prisma.bookmark.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((row) => row.id)).toEqual(["rebuild-a", "rebuild-b"]);
    for (const row of rows) {
      expect(row.folderId).toBe("rebuild-folder");
      expect(row.readAt).toEqual(readAt);
      expect(row.embeddingModel).toBe("changed-model");
      expect(row.embeddingDimensions).toBe(2);
    }
    expect(ids(await getBookmarks(query))).toEqual(["rebuild-b", "rebuild-a"]);
  });

  it("normalizes malformed pagination and retains arbitrary compatible sources", async () => {
    await seed();
    const response = await agentGet(request({ ...parameters, page: "NaN", pageSize: "-2" }));
    expect(await response.json()).toMatchObject({ page: 1, pageSize: 50, total: 2 });
    expect(bookmarkQuerySchema.parse({ source: "custom/source", page: Infinity }).source).toBe("custom/source");
  });

  it("preserves filter, text mode and intentional sort when constructing pagination URLs", () => {
    const href = buildPageHref({ ...parameters, q: "nomic", textMode: "word", sort: "author", dir: "asc", semantic: "true" })(2);
    const params = new URL(href, "http://localhost").searchParams;
    expect(Object.fromEntries(params)).toEqual({ ...parameters, q: "nomic", textMode: "word", sort: "author", dir: "asc", semantic: "true", page: "2" });
  });
});

import { processOperationQueue } from "@/lib/operation-worker";
async function sync(request: Request) {
  const response = await submit_sync(request);
  if (response.status !== 202) return response;
  const body = await response.json();
  await processOperationQueue();
  const url = new URL(request.url); url.searchParams.set("runId", body.runId);
  return submit_sync(new Request(url, { method: "POST" }));
}
