import { indexedFixture } from "../fixtures/embedding";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bookmark, Prisma } from "@prisma/client";
import { getBookmarks, searchBookmarksSemantically } from "@/lib/bookmarks";
import { POST } from "@/app/api/bookmarks/ask/route";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  generateEmbedding: vi.fn(),
  answerLibraryQuestion: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { bookmark: { findMany: mocks.findMany } } }));
vi.mock("@/lib/llm", () => ({
  generateEmbedding: mocks.generateEmbedding,
  generateEmbeddingResult: async (text: string) => ({ vector: await mocks.generateEmbedding(text), identity: { model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 } }),
  getEffectiveEmbeddingIdentity: async () => ({ model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 }),
  answerLibraryQuestion: mocks.answerLibraryQuestion,
}));

type Candidate = Bookmark & { folder: null };

function bookmark(id: string, source = "x", similarity = 1): Candidate {
  return indexedFixture({
    id, source, tweetUrl: `https://example.com/${id}`, text: "A related idea",
    authorName: null, authorUsername: "author", createdAt: null, likeCount: null,
    replyCount: null, retweetCount: null, quoteCount: null, lang: null,
    externalUrls: null, summary: id, category: "Tech", tags: null, rawJson: null,
    folderId: "folder", importedAt: new Date("2026-01-01"), summarizedAt: null,
    editedAt: null, readAt: null, mediaDescription: null, mediaJson: null,
    embedding: new Uint8Array(new Float32Array([similarity, Math.sqrt(1 - similarity ** 2)]).buffer),
    embeddingContentHash: null, embeddingIndexedAt: null,
    enrichmentError: null, enrichmentFailures: 0, folder: null,
  });
}

function stubCandidates(rows: Candidate[], expectedScope: Prisma.BookmarkWhereInput = {}) {
  mocks.findMany
    .mockImplementationOnce((args: { where: Prisma.BookmarkWhereInput }) => {
      expect(args.where).toEqual({ AND: [expectedScope, { embedding: { not: null } }] });
      return rows;
    })
    .mockImplementationOnce((args: { where: { id: { in: string[] } } }) => {
      return rows.filter(row => args.where.id.in.includes(row.id));
    });
}

describe("semantic retrieval scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.generateEmbedding.mockResolvedValue([1, 0]);
    mocks.answerLibraryQuestion.mockResolvedValue({ answer: "Scoped answer", citations: [] });
  });

  it("requests source-scoped candidates before ranking so 60 stronger other-source hits cannot crowd them out", async () => {
    const otherSource = Array.from({ length: 60 }, (_, i) => bookmark(`x-${i}`));
    const requestedSource = [bookmark("yt-match", "yt", 0.5)];
    // Model the database source predicate over the full candidate pool.
    const pool = [...otherSource, ...requestedSource];
    mocks.findMany
      .mockImplementationOnce((args: { where: Prisma.BookmarkWhereInput }) => {
        const scoped = { AND: [{ source: "yt" }, { embedding: { not: null } }] };
        return JSON.stringify(args.where) === JSON.stringify(scoped)
          ? pool.filter(row => row.source === "yt") : pool;
      })
      .mockResolvedValueOnce(pool);

    const results = await searchBookmarksSemantically("video ideas", { source: "yt" });

    expect(results.map(row => row.id)).toEqual(["yt-match"]);
    expect(results[0].similarity).toBeCloseTo(0.5);
  });

  it("combines source, category, folder, pending status, and video without adding a keyword predicate", async () => {
    const pendingVideo = indexedFixture({ ...bookmark("matching-video"), summary: "", externalUrls: "https://vimeo.com/123" });
    stubCandidates([pendingVideo], {
      AND: [
        { category: "Tech" }, { folderId: "folder" }, { source: "x" },
        { OR: [{ summary: null }, { summary: "" }] },
        { OR: [
          { source: "yt" },
          ...["/video/", "youtube.com", "youtu.be", "vimeo.com"].map(url => ({ externalUrls: { contains: url } })),
        ] },
      ],
    });

    const result = await getBookmarks({
      query: "words absent from the bookmark", semantic: true,
      source: "x", category: "Tech", folderId: "folder", status: "pending", video: true,
      page: 1, pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.bookmarks.map(row => row.id)).toEqual(["matching-video"]);
  });

  it("applies the summarized status before ranking", async () => {
    stubCandidates([bookmark("done")], {
      AND: [{ summary: { not: null } }, { NOT: { summary: "" } }],
    });
    expect(await searchBookmarksSemantically("related", { status: "summarized" })).toHaveLength(1);
  });

  it("preserves unscoped top-50 selection, total, requested sort, and pagination", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => bookmark(String(i).padStart(2, "0"), "x", 1 - i / 100));
    stubCandidates(rows);

    const result = await getBookmarks({
      query: "ideas", semantic: true, page: 2, pageSize: 3, sort: "summary", dir: "desc",
    });

    expect(result.total).toBe(50);
    expect(result.bookmarks.map(row => row.id)).toEqual(["46", "45", "44"]);
    expect(mocks.findMany.mock.calls[1][0].where.id.in).toHaveLength(50);
  });

  it("decodes only the bytes belonging to an embedding buffer view", async () => {
    const backing = new Uint8Array(16);
    backing.set(new Uint8Array(new Float32Array([0.5, Math.sqrt(0.75)]).buffer), 4);
    stubCandidates([{ ...bookmark("offset"), embedding: backing.subarray(4, 12) }]);

    const [result] = await searchBookmarksSemantically("related");

    expect(result.similarity).toBeCloseTo(0.5);
  });

  it("Ask passes source into retrieval and keeps its 12-match context and citation contract", async () => {
    const rows = Array.from({ length: 14 }, (_, i) => bookmark(`yt-${i}`, "yt", 1 - i / 100));
    stubCandidates(rows, { source: "yt" });
    mocks.answerLibraryQuestion.mockResolvedValue({
      answer: "Scoped answer", citations: [{ id: "yt-0", reason: "Relevant" }, { id: "unknown", reason: "Exclude" }],
    });

    const response = await POST(new Request("http://localhost/api/bookmarks/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "video ideas", source: "yt" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.matches).toHaveLength(12);
    expect(body.citations).toEqual([expect.objectContaining({ id: "yt-0", reason: "Relevant", source: "yt" })]);
    expect(mocks.answerLibraryQuestion).toHaveBeenCalledWith({
      question: "video ideas", candidates: body.matches, signal: expect.any(AbortSignal),
    });
  });

  it("Ask with no source retrieves the unscoped library", async () => {
    stubCandidates([bookmark("x-match"), bookmark("yt-match", "yt")]);
    const response = await POST(new Request("http://localhost/api/bookmarks/ask", {
      method: "POST", body: JSON.stringify({ question: "ideas" }),
    }));
    const body = await response.json();
    expect(body.matches.map((row: { source: string }) => row.source)).toEqual(["x", "yt"]);
  });
});
