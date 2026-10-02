import { createHash } from "node:crypto";
import { decodeEmbedding, normalizeEmbeddingEndpoint, validateEmbeddingVector, type EmbeddingIdentity } from "./embedding-vector";
import type { Bookmark, Prisma } from "@prisma/client";

export type IndexedContent = Pick<Bookmark, "summary" | "category" | "tags">;
export type ContentSnapshot = IndexedContent & Pick<Bookmark, "editedAt">;

export function embeddingContentHash(content: IndexedContent) {
  return createHash("sha256")
    .update(JSON.stringify([content.summary, content.category, content.tags]))
    .digest("hex");
}

export function embeddingInvalidation(
  existing: IndexedContent,
  next: Partial<IndexedContent>
) {
  const fields: (keyof IndexedContent)[] = ["summary", "category", "tags"];
  const changed = fields.some(
    (field) => next[field] !== undefined && next[field] !== existing[field]
  );
  return changed
    ? { embedding: null, embeddingContentHash: null, embeddingIndexedAt: null, embeddingModel: null, embeddingEndpoint: null, embeddingDimensions: null }
    : {};
}

export async function saveEmbeddingIfUnchanged(
  tx: Prisma.TransactionClient,
  input: { id: string; snapshot: ContentSnapshot; embedding: Uint8Array; identity?: EmbeddingIdentity }
) {
  validateEmbeddingVector(decodeEmbedding(input.embedding), input.identity?.dimensions);
  const result = await tx.bookmark.updateMany({
    where: { id: input.id, ...input.snapshot },
    data: {
      embedding: Buffer.from(input.embedding),
      embeddingContentHash: embeddingContentHash(input.snapshot),
      embeddingIndexedAt: new Date(),
      embeddingModel: input.identity?.model ?? null,
      embeddingEndpoint: input.identity ? normalizeEmbeddingEndpoint(input.identity.endpoint) : null,
      embeddingDimensions: input.identity?.dimensions ?? null,
    },
  });
  return result.count === 1;
}

export async function saveEnrichmentIfUnchanged(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    snapshot: ContentSnapshot;
    content: IndexedContent;
    embedding: number[] | undefined;
    embeddingIdentity?: EmbeddingIdentity;
  }
) {
  if (input.embedding) validateEmbeddingVector(input.embedding, input.embeddingIdentity?.dimensions);
  const result = await tx.bookmark.updateMany({
    where: { id: input.id, ...input.snapshot },
    data: {
      ...input.content,
      embedding: input.embedding ? Buffer.from(new Float32Array(input.embedding).buffer) : null,
      embeddingContentHash: input.embedding ? embeddingContentHash(input.content) : null,
      embeddingIndexedAt: input.embedding ? new Date() : null,
      embeddingModel: input.embedding ? input.embeddingIdentity?.model ?? null : null,
      embeddingEndpoint: input.embedding && input.embeddingIdentity ? normalizeEmbeddingEndpoint(input.embeddingIdentity.endpoint) : null,
      embeddingDimensions: input.embedding ? input.embeddingIdentity?.dimensions ?? null : null,
      summarizedAt: new Date(),
      editedAt: null,
      enrichmentError: null,
      enrichmentFailures: 0,
    },
  });
  return result.count === 1;
}

export function contentSnapshot(content: ContentSnapshot): ContentSnapshot {
  return { summary: content.summary, category: content.category, tags: content.tags, editedAt: content.editedAt };
}

export type IndexedBookmark = IndexedContent & Pick<Bookmark, "embedding" | "embeddingContentHash" | "embeddingIndexedAt" | "embeddingModel" | "embeddingEndpoint" | "embeddingDimensions">;
export type IndexState = "usable" | "missing" | "legacy" | "stale" | "incompatible" | "malformed";

export function bookmarkIndexState(bookmark: IndexedBookmark, identity: Pick<EmbeddingIdentity, "model" | "endpoint"> & { dimensions?: number }): IndexState {
  if (!bookmark.embedding) return "missing";
  if (!bookmark.embeddingModel || !bookmark.embeddingEndpoint || !bookmark.embeddingDimensions || !bookmark.embeddingContentHash || !bookmark.embeddingIndexedAt) return "legacy";
  if (bookmark.embeddingContentHash !== embeddingContentHash(bookmark)) return "stale";
  try {
    if (bookmark.embeddingModel !== identity.model || normalizeEmbeddingEndpoint(bookmark.embeddingEndpoint) !== normalizeEmbeddingEndpoint(identity.endpoint) || (identity.dimensions !== undefined && bookmark.embeddingDimensions !== identity.dimensions)) return "incompatible";
    validateEmbeddingVector(decodeEmbedding(bookmark.embedding), bookmark.embeddingDimensions);
    return "usable";
  } catch { return "malformed"; }
}
