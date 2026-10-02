/** Page responses are bounded even if a provider ignores its requested page size. */
export async function readProviderJson(response: Response): Promise<unknown> {
  const limit = 8 * 1024 * 1024;
  if (Number(response.headers?.get("content-length")) > limit) throw new Error("Provider response exceeds the import page limit.");
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("Provider response exceeds the import page limit."); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}
