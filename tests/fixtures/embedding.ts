import { embeddingContentHash } from "@/lib/embedding-index";

export const fixtureEmbeddingIdentity = { model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 };

export function indexedFixture<T extends { summary?: string | null; category?: string | null; tags?: string | null }>(row: T) {
  return { ...row,
    embeddingContentHash: embeddingContentHash({ summary: row.summary ?? null, category: row.category ?? null, tags: row.tags ?? null }),
    embeddingIndexedAt: new Date("2026-01-01"),
    embeddingModel: fixtureEmbeddingIdentity.model,
    embeddingEndpoint: fixtureEmbeddingIdentity.endpoint,
    embeddingDimensions: fixtureEmbeddingIdentity.dimensions,
  };
}
