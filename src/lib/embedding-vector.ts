import { z } from "zod";

export const embeddingIdentitySchema = z.object({
  model: z.string().trim().min(1),
  endpoint: z.string().url(),
  dimensions: z.number().int().min(1).max(65536),
});
export type EmbeddingIdentity = z.infer<typeof embeddingIdentitySchema>;
export type GeneratedEmbedding = { vector: number[]; identity: EmbeddingIdentity };

export function normalizeEmbeddingEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

export function validateEmbeddingVector(vector: number[], dimensions?: number) {
  if (!vector.length || vector.length > 65536) throw new Error("Embedding dimensions must be between 1 and 65536. Check the embedding model in Settings.");
  if (dimensions !== undefined && vector.length !== dimensions) throw new Error("Embedding dimensions do not match. Rebuild the index for the current model in Settings.");
  let magnitude = 0;
  for (const value of vector) {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new Error("Embedding contains invalid numeric values. Check the embedding server and rebuild the index.");
    const stored = Math.fround(value);
    magnitude += stored * stored;
  }
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error("Embedding has zero or invalid magnitude. Check the embedding server and rebuild the index.");
  return vector;
}

export function decodeEmbedding(bytes: Uint8Array) {
  if (bytes.byteLength % 4 !== 0) throw new Error("Embedding byte length is invalid. Rebuild the index.");
  // Copy the exact view, rather than decoding unrelated bytes from its backing buffer.
  return validateEmbeddingVector(Array.from(new Float32Array(new Uint8Array(bytes).buffer)));
}
