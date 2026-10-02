import { vi } from "vitest";

/** Mock only the external socket. Hop validation and deadline orchestration remain real. */
vi.mock("@/lib/public-web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-web")>();
  return { ...actual, publicWebTransport: async (url: URL, { signal, byteLimit }: { signal: AbortSignal; byteLimit: number }) => {
    const response = await fetch(url, { signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) return { status: response.status, headers: { location: response.headers.get("location") ?? undefined }, text: "" };
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, headers: {}, text: "" };
    const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > byteLimit) { await reader.cancel(); throw new Error("Source byte limit exceeded."); }
        chunks.push(part.value);
      }
      return { status: response.status, headers: { contentType: response.headers.get("content-type") ?? undefined }, text: Buffer.concat(chunks).toString("utf8") };
    } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
  } };
});
