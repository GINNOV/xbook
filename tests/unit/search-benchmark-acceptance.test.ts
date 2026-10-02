// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { createMigratedDatabase } from "../fixtures/migrated-database";
import { embeddingContentHash } from "@/lib/embedding-index";
import { getBookmarks, searchBookmarksSemantically } from "@/lib/bookmarks";
import type { BookmarkQueryInput } from "@/lib/bookmark-query";

const measurements = vi.hoisted(() => ({ embeddingGenerationMs: 0 }));
const holder = vi.hoisted(() => ({ database: undefined as PrismaClient | undefined }));
vi.mock("@/lib/db", () => ({ get prisma() { if (!holder.database) throw new Error("Synthetic benchmark database not ready"); return holder.database; } }));
vi.mock("@/lib/llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/llm")>();
  return { ...original, generateEmbeddingResult: async (...args: Parameters<typeof original.generateEmbeddingResult>) => {
    const start = performance.now();
    try { return await original.generateEmbeddingResult(...args); }
    finally { measurements.embeddingGenerationMs += performance.now() - start; }
  } };
});

const dimensions = 768;
const fixtureDelayMs = 20;
const vector = (axis: number, score = 1) => Array.from({ length: dimensions }, (_, index) => index === axis ? score : index === dimensions - 1 && score < 1 ? Math.sqrt(1 - score ** 2) : 0);
const semanticQueries = [
  { query: "distributed clocks", id: "known-clocks", axis: 0, source: "x", category: "Tech", folderId: "systems", status: "unread" },
  { query: "coral reef monitoring", id: "known-coral", axis: 1, source: "yt", category: "Science", folderId: "marine", status: "summarized", video: true },
  { query: "naive bayes tutorial", id: "known-bayes", axis: 2, source: "x", category: "Tech", folderId: "systems" },
  { query: "winter cooking", id: "known-cooking", axis: 3, source: "yt", category: "Food", folderId: "cooking" },
  { query: "human corrected result", id: "known-corrected", axis: 4, source: "x", category: "Tech", folderId: "systems" },
  { query: "rareterm retrieval", id: "known-rareterm", axis: 5, source: "x", folderId: "systems" },
  { query: "entire library corrected result", id: "known-corrected", axis: 4, source: "", category: "", folderId: "" },
];
const exactQueries = [
  { query: "rareterm", textMode: "word", id: "known-rareterm", folderId: "systems" },
  { query: "NAÏVE BAYES", textMode: "phrase", id: "known-bayes", source: "x" },
  { query: "A/B test alpha", textMode: "phrase", id: "known-phrase", source: "x", folderId: "systems" },
  { query: "C++", textMode: "substring", id: "known-symbol", source: "x" },
] as const;
const results: Array<{ size: number; query: string; mode: string; knownItem: string; top5: string[]; recalled: boolean; totalMs: number; embeddingGenerationMs: number; localRetrievalMs: number; fallback: string | null }> = [];
let directory: string;
let filename: string;
let endpoint: string;
let providerUnavailable = false;
const providerRequest = z.object({ model: z.literal("controlled-fixture-768d"), input: z.string(), encoding_format: z.enum(["base64", "float"]).optional() });
const provider = createServer(async (request, response) => {
  if (request.url !== "/v1/embeddings") { response.statusCode = 404; response.end(); return; }
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const parsed = providerRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString()));
  await new Promise((resolve) => setTimeout(resolve, fixtureDelayMs));
  response.setHeader("Content-Type", "application/json");
  if (providerUnavailable) { response.statusCode = 503; response.end(JSON.stringify({ error: { message: "Controlled offline fixture" } })); return; }
  if (!parsed.success) { response.statusCode = 400; response.end(JSON.stringify({ error: "Unexpected fixture request" })); return; }
  const axis = semanticQueries.find((entry) => entry.query === parsed.data.input)?.axis ?? 5;
  response.end(JSON.stringify({ object: "list", model: parsed.data.model, data: [{ object: "embedding", index: 0, embedding: parsed.data.encoding_format === "base64" ? Buffer.from(new Float32Array(vector(axis)).buffer).toString("base64") : vector(axis) }], usage: { prompt_tokens: 5, total_tokens: 5 } }));
});

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "xbook-search-benchmark-")); filename = join(directory, "fixture.db");
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); if (!address || typeof address === "string") throw new Error("No benchmark provider address");
  endpoint = `http://127.0.0.1:${address.port}/v1`;
  createMigratedDatabase(filename).close();
  holder.database = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: filename }) });
});
afterAll(async () => {
  await holder.database?.$disconnect(); provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
  if (process.env.XBOOK_BENCHMARK_OUTPUT) {
    writeFileSync(resolve(process.env.XBOOK_BENCHMARK_OUTPUT), JSON.stringify({ date: new Date().toISOString(), node: process.version,
      fixture: "Real migrated SQLite; controlled768-dimensional HTTP embeddings; no live quality acceptance", fixtureDelayMs, vectorDimensions: dimensions, platform: process.platform, architecture: process.arch,
      sizes: [100, 1000, 10000], queriesPerSize: semanticQueries.length + exactQueries.length, fallbackQueriesPerSize: 1,
      scopeChecks: ["source", "category", "folder", "unread", "summarized", "video"],
      excludedVectorStates: ["stale", "malformed byte length", "NaN", "wrong model", "legacy"], results }, null, 2) + "\n");
  }
  rmSync(directory, { recursive: true, force: true });
});

function seed(size: number) {
  const db = new Database(filename);
  try {
    db.exec("DELETE FROM Bookmark; DELETE FROM BookmarkFolder; DELETE FROM Settings");
    db.prepare("INSERT INTO Settings(id,updatedAt,llmEmbeddingModel,llmEmbeddingBaseUrl,llmApiKey) VALUES('default',CURRENT_TIMESTAMP,?,?,?)").run("controlled-fixture-768d", endpoint, "synthetic-fixture-key");
    const folder = db.prepare("INSERT INTO BookmarkFolder(id,name,updatedAt) VALUES(?,?,CURRENT_TIMESTAMP)");
    for (const id of ["systems", "marine", "cooking", "outside"]) folder.run(id, id);
    const insert = db.prepare("INSERT INTO Bookmark(id,source,tweetUrl,text,summary,category,tags,folderId,readAt,summarizedAt,embedding,embeddingContentHash,embeddingIndexedAt,embeddingModel,embeddingEndpoint,embeddingDimensions) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    function add(id: string, text: string, axis: number, source = "x", category = "Tech", folderId = "systems", read = false, bytes?: Buffer, hash?: string, model = "controlled-fixture-768d") {
      const summary = text;
      insert.run(id, source, source === "yt" ? `https://www.youtube.com/watch?v=${id}` : `https://x.test/${id}`, text, summary, category, "fixture", folderId,
        read ? "2026-01-01T00:00:00.000Z" : null, "2026-01-01T00:00:00.000Z", bytes ?? Buffer.from(new Float32Array(vector(axis, id.startsWith("known") ? 0.99 : 1)).buffer),
        hash ?? embeddingContentHash({ summary, category, tags: "fixture" }), "2026-01-01T00:00:00.000Z", model, endpoint, dimensions);
    }
    db.transaction(() => {
      const inserted = new Set<string>();
      for (const query of semanticQueries) {
        if (inserted.has(query.id)) continue; inserted.add(query.id);
        add(query.id, query.id === "known-bayes" ? "NAÏVE BAYES complete tutorial" : query.id === "known-rareterm" ? "rareterm complete token" : query.query, query.axis, query.source, query.category ?? "Tech", query.folderId);
      }
      add("known-phrase", "A/B test alpha experiment", 6); add("known-symbol", "C++ memory safety", 7);
      for (let index = 0; index < 65; index++) add(`outside-${index}`, "Distributed clock outside scope raretermish", 0, "yt", "Other", "outside", true);
      add("invalid-stale", "Human corrected result", 4, "x", "Tech", "systems", false, undefined, "wrong-old-content-hash");
      add("invalid-bytes", "Human corrected result", 4, "x", "Tech", "systems", false, Buffer.from([1, 2, 3]));
      add("invalid-nan", "Human corrected result", 4, "x", "Tech", "systems", false, Buffer.from(new Float32Array([NaN, ...Array(dimensions - 1).fill(0)]).buffer));
      add("invalid-model", "Human corrected result", 4, "x", "Tech", "systems", false, undefined, undefined, "different-model");
      add("invalid-legacy", "Human corrected result", 4); db.prepare("UPDATE Bookmark SET embeddingContentHash=NULL,embeddingModel=NULL WHERE id='invalid-legacy'").run();
      const current = z.object({ count: z.number() }).parse(db.prepare("SELECT COUNT(*) AS count FROM Bookmark").get()).count;
      for (let index = current; index < size; index++) add(`filler-${String(index).padStart(5, "0")}`, `Filler library record ${index} raretermish`, dimensions - 1, index % 2 ? "x" : "yt", "Other", "outside", true);
    })();
    expect(z.object({ count: z.number() }).parse(db.prepare("SELECT COUNT(*) AS count FROM Bookmark").get()).count).toBe(size);
  } finally { db.close(); }
}

async function measure(size: number, knownItem: string, input: BookmarkQueryInput) {
  measurements.embeddingGenerationMs = 0;
  const start = performance.now(); const found = await getBookmarks({ ...input, pageSize: 5 }); const totalMs = performance.now() - start;
  const top5 = found.bookmarks.map((bookmark) => bookmark.id);
  const entry = { size, query: String(input.query), mode: input.semantic ? "semantic" : `keyword:${input.textMode ?? "substring"}`, knownItem, top5,
    recalled: top5.includes(knownItem), totalMs, embeddingGenerationMs: measurements.embeddingGenerationMs,
    localRetrievalMs: Math.max(0, totalMs - measurements.embeddingGenerationMs), fallback: found.search.fallback };
  if (input.semantic && !providerUnavailable && found.search.mode !== "semantic") await searchBookmarksSemantically(String(input.query));
  results.push(entry); expect(entry.recalled).toBe(true);
  return found;
}
for (const size of [100, 1000, 10000]) {
  it(`benchmarks fixed scoped/exact query set over ${size} actual SQLite bookmarks`, async () => {
    seed(size); providerUnavailable = false;
    for (const query of semanticQueries) {
      const found = await measure(size, query.id, { query: query.query, semantic: true, source: query.source, category: query.category,
        folderId: query.folderId, status: "status" in query ? query.status : "", video: "video" in query ? query.video : false });
      expect(found.search.mode).toBe("semantic"); expect(found.search.fallback).toBeNull();
      expect(found.bookmarks.some((row) => row.id.startsWith("outside-") || row.id.startsWith("invalid-"))).toBe(false);
    }
    for (const query of exactQueries) {
      const found = await measure(size, query.id, { query: query.query, textMode: query.textMode, source: "source" in query ? query.source : "", folderId: "folderId" in query ? query.folderId : "" });
      expect(found.search.mode).toBe("keyword"); expect(found.total).toBe(1);
    }
    providerUnavailable = true;
    const fallback = await measure(size, "known-rareterm", { query: "rareterm", semantic: true, textMode: "word", source: "x", folderId: "systems" });
    expect(fallback.search).toMatchObject({ mode: "keyword", fallback: "embedding_unavailable" }); expect(fallback.total).toBe(1);
  }, 15000);
}
