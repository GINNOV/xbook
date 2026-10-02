import { createHash } from "node:crypto";
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
    ? { embedding: null, embeddingContentHash: null, embeddingIndexedAt: null }
    : {};
}

export async function saveEmbeddingIfUnchanged(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    snapshot: ContentSnapshot;
    embedding: Uint8Array;
    model?: string | null;
    dimensions?: number;
  }
) {
  const result = await tx.bookmark.updateMany({
    where: { id: input.id, ...input.snapshot },
    data: {
      embedding: Buffer.from(input.embedding),
      embeddingContentHash: embeddingContentHash(input.snapshot),
      embeddingIndexedAt: new Date(),
      // Null stays null for an unknown legacy model. Do not invent an identity.
      embeddingModel: input.model?.trim() || null,
      embeddingDimensions: input.dimensions ?? null,
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
    replaceHuman?: boolean;
    model?: string | null;
  }
) {
  if (!input.replaceHuman) {
    const human = await tx.bookmark.findFirst({
      where: { id: input.id, editedAt: { not: null } },
      select: { editedAt: true },
    });
    if (human) {
      await tx.bookmark.updateMany({
        where: { id: input.id, editedAt: human.editedAt },
        data: { enrichmentError: null, enrichmentFailures: 0 },
      });
      return false;
    }
  }
  const result = await tx.bookmark.updateMany({
    where: { id: input.id, ...input.snapshot },
    data: {
      ...input.content,
      embedding: input.embedding ? Buffer.from(new Float32Array(input.embedding).buffer) : null,
      embeddingContentHash: input.embedding ? embeddingContentHash(input.content) : null,
      embeddingIndexedAt: input.embedding ? new Date() : null,
      embeddingModel: input.embedding && input.model?.trim() ? input.model.trim() : null,
      embeddingDimensions: input.embedding ? input.embedding.length : null,
      summarizedAt: new Date(),
      editedAt: null,
      summarySource: input.replaceHuman ? "replaced" : "model",
      enrichmentError: null,
      enrichmentFailures: 0,
    },
  });
  return result.count === 1;
}

export function contentSnapshot(content: ContentSnapshot): ContentSnapshot {
  return { summary: content.summary, category: content.category, tags: content.tags, editedAt: content.editedAt };
}
