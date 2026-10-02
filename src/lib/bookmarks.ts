import { prisma } from "./db";
import { normalizeBookmarkPagination, effectiveBookmarkPagination } from "./bookmark-pagination";
import type { Prisma } from "@prisma/client";
import { generateEmbedding } from "./llm";
import {
  parseBookmarkSort,
  prismaBookmarkOrderBy,
  sortBookmarkItems,
} from "./bookmark-sort";
import { normalizeTextMatch, textMatchClause, type TextMatch } from "./bookmark-text";
import { decodeEmbedding } from "./embedding-vectors";

export type BookmarkItem = {
  id: string; source: string; tweetUrl: string; text: string | null; folderName: string | null; summary: string | null;
  category: string | null; tags: string | null; authorUsername: string | null; importedAt: string | null;
  createdAt: string | null; summarizedAt: string | null; editedAt: string | null; readAt: string | null;
  error: string | null; folder?: { name: string | null } | null; similarity?: number;
};

export function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < vecA.length; i++) { dot += vecA[i] * vecB[i]; nA += vecA[i] * vecA[i]; nB += vecB[i] * vecB[i]; }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

export type BookmarkSearchScope = {
  source?: string;
  category?: string;
  folderId?: string;
  status?: string;
  video?: boolean;
  match?: TextMatch;
};

export async function searchBookmarksSemantically(query: string, scope: BookmarkSearchScope = {}) {
  const qe = await generateEmbedding(query);
  const where = buildWhereClause({ ...scope, query: undefined });
  const bs = await prisma.bookmark.findMany({ where: { AND: [where, { embedding: { not: null } }] }, select: { id: true, embedding: true } });
  const results = bs.flatMap(b => {
    if (!b.embedding) return [];
    const embedding = decodeEmbedding(new Uint8Array(b.embedding), qe.length);
    if (!embedding) return [];
    const similarity = cosineSimilarity(qe, embedding);
    if (!Number.isFinite(similarity)) return [];
    return [{ id: b.id, similarity }];
  }).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id)).slice(0, 50);
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

export function unreadWhere() {
  return { readAt: null };
}

/** Stored vector with no recorded model. Identity is unknown until a rebuild. */
export function staleIndexWhere() {
  return {
    embedding: { not: null },
    OR: [{ embeddingModel: null }, { embeddingContentHash: null }],
  };
}

function buildStatusFilter(status?: string) {
  if (status === "pending") return pendingEnrichmentWhere();
  if (status === "summarized") return summarizedEnrichmentWhere();
  if (status === "unread") return unreadWhere();
  if (status === "failed") return failedEnrichmentWhere();
  if (status === "blocked") return blockedEnrichmentWhere();
  if (status === "unindexed") return { embedding: null, ...summarizedEnrichmentWhere() };
  if (status === "stale") return staleIndexWhere();
  return {};
}

function buildWhereClause(p: BookmarkSearchScope & { query?: string; match?: TextMatch }) {
  const videoUrls = ["/video/", "youtube.com", "youtu.be", "vimeo.com"];
  // Compose with AND so multiple OR groups (query, status=pending, video) never
  // overwrite each other via object-spread key collision.
  const clauses: Prisma.BookmarkWhereInput[] = [];
  if (p.query) clauses.push(textMatchClause(p.query, normalizeTextMatch(p.match)));
  if (p.category) clauses.push({ category: p.category });
  if (p.folderId) clauses.push({ folderId: p.folderId });
  if (p.source) clauses.push({ source: p.source });
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

const mapB = (b: any) => ({
  ...b, folderName: b.folder?.name ?? null, importedAt: b.importedAt?.toISOString() ?? null,
  createdAt: b.createdAt?.toISOString() ?? null, summarizedAt: b.summarizedAt?.toISOString() ?? null,
  editedAt: b.editedAt?.toISOString() ?? null, readAt: b.readAt?.toISOString() ?? null,
  // Prefer durable bookmark field; fall back to latest failed processing event.
  error: b.enrichmentError || b.processingEvents?.[0]?.message || null,
});

export type BookmarkListResult = {
  bookmarks: ReturnType<typeof mapB>[];
  total: number;
  page: number;
  pageSize: number;
  semanticError?: string;
};

export async function getBookmarks(p: BookmarkSearchScope & {
  query?: string;
  page?: unknown;
  pageSize?: unknown;
  semantic?: boolean;
  sort?: string | null;
  dir?: string | null;
  match?: TextMatch;
}): Promise<BookmarkListResult> {
  const { sort, dir } = parseBookmarkSort(p.sort, p.dir, Boolean(p.semantic && p.query));
  const requested = normalizeBookmarkPagination(p.page, p.pageSize);
  const match = normalizeTextMatch(p.match);
  if (p.semantic && p.query) {
    try {
      return await performSemanticSearch(p.query, requested.page, requested.pageSize, sort, dir, p);
    } catch (error) {
      const keyword = await getBookmarks({ ...p, semantic: false, match });
      return {
        ...keyword,
        semanticError: error instanceof Error
          ? `${error.message} Keyword search is still available. Check the embedding model in Settings → AI.`
          : "Semantic search is unavailable. Keyword search is still available.",
      };
    }
  }
  const where = buildWhereClause(p);
  const total = await prisma.bookmark.count({ where });
  const { page, pageSize } = effectiveBookmarkPagination(requested.page, requested.pageSize, total);
  const raw = await prisma.bookmark.findMany({
    where, include: { folder: true, processingEvents: { where: { status: "failed" }, orderBy: { createdAt: "desc" }, take: 1, select: { message: true } } },
    orderBy: prismaBookmarkOrderBy(sort, dir), skip: (page - 1) * pageSize, take: pageSize,
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
  unread: number;
  failed: number;
  blocked: number;
  unindexed: number;
  stale: number;
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
    unread,
    failed,
    blocked,
    unindexed,
    stale,
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
    prisma.bookmark.count({ where: { ...sourceWhere, ...unreadWhere() } }),
    prisma.bookmark.count({ where: { ...sourceWhere, ...failedEnrichmentWhere() } }),
    prisma.bookmark.count({ where: { ...sourceWhere, ...blockedEnrichmentWhere() } }),
    prisma.bookmark.count({ where: { ...sourceWhere, embedding: null, ...summarizedEnrichmentWhere() } }),
    prisma.bookmark.count({ where: { ...sourceWhere, ...staleIndexWhere() } }),
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
    unread,
    failed,
    blocked,
    unindexed,
    stale,
  };

  return { categories, folders: folderList, counts };
}
