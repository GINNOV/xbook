/** Decode a stored little-endian float32 vector. Rejects bad length, non-finite values, and zero magnitude. */
export function decodeEmbedding(bytes: Uint8Array, queryLength?: number): number[] | null {
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) return null;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const view = new Float32Array(copy.buffer);
  if (queryLength !== undefined && view.length !== queryLength) return null;
  const values: number[] = [];
  let magnitude = 0;
  for (const value of view) {
    if (!Number.isFinite(value)) return null;
    magnitude += value * value;
    values.push(value);
  }
  if (magnitude === 0) return null;
  return values;
}
