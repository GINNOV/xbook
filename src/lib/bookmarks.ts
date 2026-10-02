import { prisma } from "./db";
import { bookmarkIndexState } from "./embedding-index";
import { decodeEmbedding, validateEmbeddingVector } from "./embedding-vector";
import { getIndexHealth } from "./index-health";
import { effectiveBookmarkPagination } from "./bookmark-pagination";
import type { Prisma, ProcessingEvent } from "@prisma/client";
import { bookmarkQuerySchema, matchesBookmarkText, type BookmarkQueryInput, type BookmarkQuery, type BookmarkSearchScope } from "./bookmark-query";
export type { BookmarkSearchScope } from "./bookmark-query";
import { generateEmbeddingResult, getEffectiveEmbeddingIdentity } from "./llm";
import {
  parseBookmarkSort,
  prismaBookmarkOrderBy,
  sortBookmarkItems,
} from "./bookmark-sort";

export type BookmarkItem = {
  id: string; source: string; tweetUrl: string; text: string | null; folderName: string | null; summary: string | null;
  category: string | null; tags: string | null; authorUsername: string | null; importedAt: string | null;
  createdAt: string | null; summarizedAt: string | null; editedAt: string | null; readAt: string | null;
  error: string | null; folder?: { name: string | null } | null; similarity?: number;
};

export function cosineSimilarity(vecA: number[], vecB: number[]) {
  validateEmbeddingVector(vecA);
  validateEmbeddingVector(vecB, vecA.length);
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < vecA.length; i++) { dot += vecA[i] * vecB[i]; nA += vecA[i] * vecA[i]; nB += vecB[i] * vecB[i]; }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

export async function searchBookmarksSemantically(query: string, scope: BookmarkSearchScope = {}) {
  const generated = await generateEmbeddingResult(query);
  const qe = generated.vector;
  const where = await buildWhereClause({ ...scope, query: undefined });
  const bs = await prisma.bookmark.findMany({ where: { AND: [where, { embedding: { not: null } }] }, select: { id: true, summary: true, category: true, tags: true, embedding: true, embeddingModel: true, embeddingEndpoint: true, embeddingDimensions: true, embeddingContentHash: true, embeddingIndexedAt: true } });
  const results = bs.flatMap(b => {
    if (!b.embedding || bookmarkIndexState(b, generated.identity) !== "usable") return [];
    // Prisma may return a view into a larger buffer; copy only this vector's bytes.
    const embedding = decodeEmbedding(b.embedding);
    return [{ id: b.id, similarity: cosineSimilarity(qe, embedding) }];
  }).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id)).slice(0, 50);
  if (bs.length && !results.length) throw new Error("No compatible embeddings. Rebuild the index for the current model; keyword search remains available.");
  const full = await prisma.bookmark.findMany({ where: { id: { in: results.map(r => r.id) } }, include: { folder: true } });
  return results.map(r => { const f = full.find(fb => fb.id === r.id); return f ? { ...f, similarity: r.similarity } : null; }).filter((b): b is NonNullable<typeof b> => !!b);
}

/**
 * Pending = still needs a real summary.
 * Category alone (e.g. stub "Other" with empty summary) does NOT count as done —
 * those used to zero-out the dashboard Pending tile while Enrich skipped them.
 */
export function pendingEnrichmentWhere() {
  return {
    OR: [{ summary: null }, { summary: "" }],
  };
}

/** Summarized = non-empty summary (strict complement of pending). */
export function summarizedEnrichmentWhere() {
  return {
    AND: [{ summary: { not: null } }, { NOT: { summary: "" } }],
  };
}

/** Current enrichment failures: last attempt left a non-empty error on the bookmark. */
export function failedEnrichmentWhere() {
  return {
    AND: [{ enrichmentError: { not: null } }, { NOT: { enrichmentError: "" } }],
  };
}

/**
 * Blocked from automatic enrich: still pending and has exhausted the default retry budget
 * (see enrich route: enrichmentFailures < 3 unless full/reprocess).
 */
export function blockedEnrichmentWhere() {
  return {
    ...pendingEnrichmentWhere(),
    enrichmentFailures: { gte: 3 },
  };
}

/**
 * Bookmarks that can be (re)indexed: non-empty summary and no embedding yet.
 * Dashboard "missing" and POST /api/bookmarks/embeddings/sync must use the same predicate.
 */
export function needsEmbeddingWhere(source?: "x" | "yt" | string | null) {
  return {
    ...(source ? { source } : {}),
    embedding: null,
    AND: [{ summary: { not: null } }, { NOT: { summary: "" } }],
  };
}

function buildStatusFilter(status?: BookmarkQuery["status"]) {
  if (status === "pending") return pendingEnrichmentWhere();
  if (status === "summarized") return summarizedEnrichmentWhere();
  if (status === "unread") return { readAt: null };
  if (status === "failed") return failedEnrichmentWhere();
  if (status === "blocked") return blockedEnrichmentWhere();

  return {};
}

async function buildWhereClause(p: BookmarkSearchScope & { query?: string }) {
  const videoUrls = ["/video/", "youtube.com", "youtu.be", "vimeo.com"];
  // Compose with AND so multiple OR groups (query, status=pending, video) never
  // overwrite each other via object-spread key collision.
  const clauses: Prisma.BookmarkWhereInput[] = [];
  if (p.query) {
    clauses.push({
      OR: [
        { text: { contains: p.query } },
        { summary: { contains: p.query } },
        { category: { contains: p.query } },
        { authorUsername: { contains: p.query } },
        { authorName: { contains: p.query } },
        { tags: { contains: p.query } },
      ],
    });
  }
  if (p.category) clauses.push({ category: p.category });
  if (p.folderId) clauses.push({ folderId: p.folderId });
  if (p.source) clauses.push({ source: p.source });
  if (p.status === "stale" || p.status === "unindexed") {
    const health = await getIndexHealth(prisma, await getEffectiveEmbeddingIdentity(), p.source);
    clauses.push({ id: { in: p.status === "stale" ? health.staleIds : health.rebuildIds } });
  }
  const statusFilter = buildStatusFilter(p.status);
  if (Object.keys(statusFilter).length > 0) clauses.push(statusFilter);
  if (p.video) {
    clauses.push({
      OR: [{ source: "yt" }, ...videoUrls.map((u) => ({ externalUrls: { contains: u } }))],
    });
  }
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { AND: clauses };
}

type BookmarkRecord = Prisma.BookmarkGetPayload<{ include: { folder: true } }> & {
  processingEvents?: Array<Pick<ProcessingEvent, "message">>;
  similarity?: number;
};

const mapB = (b: BookmarkRecord) => ({
  ...b, folderName: b.folder?.name ?? null, importedAt: b.importedAt?.toISOString() ?? null,
  createdAt: b.createdAt?.toISOString() ?? null, summarizedAt: b.summarizedAt?.toISOString() ?? null,
  editedAt: b.editedAt?.toISOString() ?? null, readAt: b.readAt?.toISOString() ?? null,
  // Prefer durable bookmark field; fall back to latest failed processing event.
  error: b.enrichmentError || b.processingEvents?.[0]?.message || null,
});

const bookmarkInclude = {
  folder: true,
  processingEvents: { where: { status: "failed" }, orderBy: { createdAt: "desc" }, take: 1, select: { message: true } },
} satisfies Prisma.BookmarkInclude;

export async function getBookmarks(input: BookmarkQueryInput) {
  const query = bookmarkQuerySchema.parse(input);
  if (query.semantic && query.query) {
    try {
      return { ...await performSemanticSearch(query.query, query.page, query.pageSize, query.sort, query.dir, query),
        sort: query.sort, dir: query.dir, search: { mode: "semantic" as const, fallback: null, limit: 50 } };
    } catch {
      const fallbackSort = parseBookmarkSort(query.sort, query.dir, false);
      return { ...await getKeywordBookmarks({ ...query, ...fallbackSort }),
        ...fallbackSort, search: { mode: "keyword" as const, fallback: "embedding_unavailable" as const, limit: null } };
    }
  }
  return { ...await getKeywordBookmarks(query), sort: query.sort, dir: query.dir,
    search: { mode: "keyword" as const, fallback: null, limit: null } };
}

async function getKeywordBookmarks(query: BookmarkQuery) {
  const exact = query.query && query.textMode !== "substring";
  const where = await buildWhereClause({ ...query, query: exact ? undefined : query.query });
  const orderBy = [prismaBookmarkOrderBy(query.sort, query.dir), { id: "asc" as const }];
  if (exact && query.textMode !== "substring") {
    // SQLite does not expose Unicode whole-word matching through Prisma. Scope first,
    // then match complete tokens and paginate the matching rows rather than the input rows.
    const candidates = await prisma.bookmark.findMany({ where,
      select: { id: true, text: true, summary: true, category: true, authorUsername: true, authorName: true, tags: true }, orderBy });
    const matched = candidates.filter((bookmark) => matchesBookmarkText(
      [bookmark.text, bookmark.summary, bookmark.category, bookmark.authorUsername, bookmark.authorName, bookmark.tags],
      query.query, query.textMode === "phrase" ? "phrase" : "word",
    ));
    const effective = effectiveBookmarkPagination(query.page, query.pageSize, matched.length);
    const offset = (effective.page - 1) * effective.pageSize;
    const pageIds = matched.slice(offset, offset + effective.pageSize).map((bookmark) => bookmark.id);
    const pageRows = await prisma.bookmark.findMany({ where: { id: { in: pageIds } }, include: bookmarkInclude, orderBy });
    return { bookmarks: pageRows.map(mapB), total: matched.length,
      page: effective.page, pageSize: effective.pageSize };
  }
  const total = await prisma.bookmark.count({ where });
  const { page, pageSize } = effectiveBookmarkPagination(query.page, query.pageSize, total);
  const raw = await prisma.bookmark.findMany({
    where, include: bookmarkInclude, orderBy, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { bookmarks: raw.map(mapB), total, page, pageSize };
}

async function performSemanticSearch(
  query: string,
  page: number,
  pageSize: number,
  sort: ReturnType<typeof parseBookmarkSort>["sort"],
  dir: ReturnType<typeof parseBookmarkSort>["dir"],
  scope: BookmarkSearchScope,
) {
  const all = await searchBookmarksSemantically(query, scope);
  const mapped = all.map(mapB);
  const sorted = sortBookmarkItems(mapped, sort, dir);
  const effective = effectiveBookmarkPagination(page, pageSize, sorted.length);
  const skip = (effective.page - 1) * effective.pageSize;
  return { bookmarks: sorted.slice(skip, skip + effective.pageSize), total: sorted.length, page: effective.page, pageSize: effective.pageSize };
}

export type FilterCategory = { name: string; count: number };
export type FilterFolder = { id: string; name: string | null; count: number };
export type FilterCounts = {
  total: number;
  pending: number;
  summarized: number;
  uncategorized: number;
  noFolder: number;
  videos: number;
};

/** Facet options + counts for the library, scoped to optional source (x | yt). */
export async function getFilterOptions(source?: string) {
  const sourceWhere = source ? { source } : {};
  const videoUrls = ["/video/", "youtube.com", "youtu.be", "vimeo.com"];

  const [
    total,
    pending,
    summarized,
    uncategorized,
    noFolder,
    videos,
    categoryGroups,
    folderGroups,
    folders,
  ] = await Promise.all([
    prisma.bookmark.count({ where: sourceWhere }),
    prisma.bookmark.count({ where: { ...sourceWhere, ...pendingEnrichmentWhere() } }),
    prisma.bookmark.count({ where: { ...sourceWhere, ...summarizedEnrichmentWhere() } }),
    prisma.bookmark.count({
      where: {
        ...sourceWhere,
        OR: [{ category: null }, { category: "" }],
      },
    }),
    prisma.bookmark.count({ where: { ...sourceWhere, folderId: null } }),
    prisma.bookmark.count({
      where: {
        ...sourceWhere,
        OR: [{ source: "yt" }, ...videoUrls.map((u) => ({ externalUrls: { contains: u } }))],
      },
    }),
    prisma.bookmark.groupBy({
      by: ["category"],
      where: {
        ...sourceWhere,
        AND: [{ category: { not: null } }, { NOT: { category: "" } }],
      },
      _count: { _all: true },
      orderBy: { category: "asc" },
    }),
    prisma.bookmark.groupBy({
      by: ["folderId"],
      where: { ...sourceWhere, folderId: { not: null } },
      _count: { _all: true },
    }),
    prisma.bookmarkFolder.findMany({
      where: { bookmarks: { some: sourceWhere } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);

  const countByFolder = new Map(
    folderGroups.map((g) => [g.folderId as string, g._count._all])
  );

  const categories: FilterCategory[] = categoryGroups
    .filter((g): g is typeof g & { category: string } => !!g.category)
    .map((g) => ({ name: g.category, count: g._count._all }));

  const folderList: FilterFolder[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    count: countByFolder.get(f.id) ?? 0,
  }));

  const counts: FilterCounts = {
    total,
    pending,
    summarized,
    uncategorized,
    noFolder,
    videos,
  };

  return { categories, folders: folderList, counts };
}
