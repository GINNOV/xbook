// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedFixture } from "../fixtures/embedding";
import { prisma } from "@/lib/db";
import { getBookmarks, searchBookmarksSemantically } from "@/lib/bookmarks";
import { POST as ask } from "@/app/api/bookmarks/ask/route";
import { POST as submit_sync } from "@/app/api/bookmarks/embeddings/sync/route";
import { generateEmbedding, answerLibraryQuestion } from "@/lib/llm";
import { rmSync } from "node:fs";

const fixture = vi.hoisted(() => ({ directory: "" }));

vi.mock("@/lib/db", async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-calibration-"));
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
      identity: { model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 },
    }),
    getEffectiveEmbeddingIdentity: async () => ({ model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 }),

  generateEmbedding,
  answerLibraryQuestion: vi.fn(),
});
});

const vector = (values: number[]) => Buffer.from(new Float32Array(values).buffer);

async function seedSearch() {
  await prisma.bookmarkFolder.create({ data: { id: "research", name: "Research" } });
  await prisma.bookmark.createMany({ data: [
    ...Array.from({ length: 55 }, (_, index) => ({
      id: `x-${index}`, source: "x", tweetUrl: `https://x.com/i/status/${index}`,
      summary: "Unrelated source", category: "Other", embedding: vector([1, 0]),
    })),
    { id: "yt-target", source: "yt", tweetUrl: "https://youtube.com/watch?v=target",
      summary: "Scoped evidence", category: "Science", folderId: "research", embedding: vector([0.8, 0.6]) },
    { id: "yt-other", source: "yt", tweetUrl: "https://youtube.com/watch?v=other",
      summary: "Other folder", category: "Other", embedding: vector([0.9, 0.4]) },
    { id: "yt-pending", source: "yt", tweetUrl: "https://youtube.com/watch?v=pending",
      summary: null, category: "Science", folderId: "research", embedding: vector([1, 0]) },
  ].map(indexedFixture) });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.processingEvent.deleteMany();
  await prisma.llmRequestLog.deleteMany();
  await prisma.operationRun.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.bookmarkFolder.deleteMany();
  vi.mocked(generateEmbedding).mockResolvedValue([1, 0]);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(fixture.directory, { recursive: true, force: true });
});

describe("calibration repairs with real SQLite and provider fixtures", () => {
  it("retrieves scoped YouTube evidence despite 55 higher-ranked X rows", async () => {
    await seedSearch();
    const result = await searchBookmarksSemantically("evidence", { source: "yt" });
    expect(result.map((row) => row.id)).toContain("yt-target");
    expect(result).toHaveLength(3);
    expect(result.every((row) => row.source === "yt" && Number.isFinite(row.similarity))).toBe(true);
  });

  it("combines library filters before semantic ranking and pagination", async () => {
    await seedSearch();
    const result = await getBookmarks({ query: "evidence", semantic: true, source: "yt",
      category: "Science", folderId: "research", status: "summarized", video: true, page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.bookmarks.map((row) => row.id)).toEqual(["yt-target"]);
  });

  it("supplies scoped evidence to Ask and keeps only valid citations", async () => {
    await seedSearch();
    vi.mocked(answerLibraryQuestion).mockResolvedValue({ answer: "Fixture answer", citations: [
      { id: "yt-target", reason: "Supports answer" }, { id: "x-0", reason: "Wrong source" },
    ] });
    const response = await ask(new Request("http://localhost/api/bookmarks/ask", {
      method: "POST", body: JSON.stringify({ question: "evidence", source: "yt" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.matches).toHaveLength(3);
    expect(body.matches.every((row: { source: string }) => row.source === "yt")).toBe(true);
    expect(body.citations.map((row: { id: string }) => row.id)).toEqual(["yt-target"]);
    expect(answerLibraryQuestion).toHaveBeenCalledWith(expect.objectContaining({
      candidates: expect.arrayContaining([expect.objectContaining({ id: "yt-target" })]),
    }));
  });

  it("persists failed runs and failed events when every embedding attempt fails", async () => {
    await prisma.bookmark.createMany({ data: ["a", "b"].map((id) => ({
      id, source: "x", tweetUrl: `https://x.com/i/status/${id}`, summary: "Needs vector", category: "Testing",
    })) });
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("Provider failed"));
    const response = await sync(new Request("http://localhost/api/bookmarks/embeddings/sync?source=x", { method: "POST" }));
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.updated).toBe(0);
    expect(body.failed).toBe(2);
    expect(body.remaining).toBe(2);
    const run = await prisma.operationRun.findUniqueOrThrow({ where: { id: body.runId } });
    expect(run.status).toBe("failed");
    expect(run.processed).toBe(2);
    expect(run.failed).toBe(2);
    expect(run.finishedAt).not.toBeNull();
    expect(await prisma.processingEvent.count({ where: { runId: run.id, status: "failed" } })).toBe(2);
    expect(await prisma.bookmark.count({ where: { embedding: null } })).toBe(2);
  });

  it("stores a successful vector and accurate counts after a partial failure", async () => {
    await prisma.bookmark.createMany({ data: ["a", "b"].map((id) => ({
      id, source: "x", tweetUrl: `https://x.com/i/status/${id}`, summary: "Needs vector", category: "Testing",
    })) });
    vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error("Provider failed")).mockResolvedValueOnce([1, 0]);
    const response = await sync(new Request("http://localhost/api/bookmarks/embeddings/sync?source=x", { method: "POST" }));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.remaining).toBe(1);
    const run = await prisma.operationRun.findUniqueOrThrow({ where: { id: body.runId } });
    expect(run.status).toBe("partial");
    expect(run.processed).toBe(2);
    expect(run.updated).toBe(1);
    expect(run.failed).toBe(1);
    expect(await prisma.bookmark.count({ where: { embedding: { not: null } } })).toBe(1);
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
