// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bookmarkIndexState, embeddingContentHash, embeddingInvalidation } from "@/lib/embedding-index";
import { cosineSimilarity } from "@/lib/bookmarks";
import { decodeEmbedding, validateEmbeddingVector, normalizeEmbeddingEndpoint } from "@/lib/embedding-vector";

const identity = { model: "nomic", endpoint: "http://localhost:11434/v1", dimensions: 2 };
const content = { summary: "Searchable", category: "Science", tags: "local" };
const current = {
  ...content, embedding: Buffer.from(new Float32Array([1, 0]).buffer),
  embeddingModel: identity.model, embeddingEndpoint: identity.endpoint, embeddingDimensions: 2,
  embeddingContentHash: embeddingContentHash(content), embeddingIndexedAt: new Date(),
};

describe("embedding compatibility boundaries", () => {
  it("accepts a current vector and rejects changed content, model, host, and dimensions", () => {
    expect(bookmarkIndexState(current, identity)).toBe("usable");
    expect(bookmarkIndexState({ ...current, summary: "Edited" }, identity)).toBe("stale");
    expect(bookmarkIndexState(current, { ...identity, model: "other" })).toBe("incompatible");
    expect(bookmarkIndexState(current, { ...identity, endpoint: "http://localhost:1234/v1" })).toBe("incompatible");
    expect(bookmarkIndexState(current, { ...identity, dimensions: 3 })).toBe("incompatible");
  });
  it("leaves unknown legacy identity unknown instead of inferring from settings", () => {
    expect(bookmarkIndexState({ ...current, embeddingModel: null }, identity)).toBe("legacy");
    expect(bookmarkIndexState({ ...current, embeddingContentHash: null }, identity)).toBe("legacy");
    expect(bookmarkIndexState({ ...current, embeddingIndexedAt: null }, identity)).toBe("legacy");
  });
  it.each([[], [0, 0], [NaN, 1], [Infinity, 1], [1e100, 1], [1e-50, 0], [Number.MIN_VALUE, 0]].map((vector) => ({ vector })))("rejects malformed provider vector $vector", ({ vector }) => {
    expect(() => validateEmbeddingVector(vector)).toThrow();
  });
  it("rejects malformed bytes and dimension mismatch without invalid comparisons", () => {
    expect(() => decodeEmbedding(new Uint8Array(3))).toThrow();
    expect(bookmarkIndexState({ ...current, embedding: Buffer.from(new Float32Array([NaN, 1]).buffer) }, identity)).toBe("malformed");
    expect(bookmarkIndexState({ ...current, embeddingDimensions: 3 }, identity)).toBe("incompatible");
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
    expect(() => cosineSimilarity([1, 0], [0, 0])).toThrow();
  });
  it("decodes only the vector's byte view", () => {
    const bytes = Buffer.alloc(16, 255);
    bytes.set(current.embedding, 4);
    expect(decodeEmbedding(bytes.subarray(4, 12))).toEqual([1, 0]);
  });
  it("invalidates the complete identity and normalizes endpoints without credentials", () => {
    expect(embeddingInvalidation(content, { tags: "changed" })).toMatchObject({
      embedding: null, embeddingModel: null, embeddingEndpoint: null, embeddingDimensions: null,
      embeddingContentHash: null, embeddingIndexedAt: null,
    });
    expect(embeddingInvalidation(content, content)).toEqual({});
    expect(normalizeEmbeddingEndpoint("http://user:password@localhost:11434/v1/?secret=token#ignored")).toBe(identity.endpoint);
  });
});
