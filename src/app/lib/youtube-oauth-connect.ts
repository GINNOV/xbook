export type YouTubeTokenSnapshot = {
  ytAccessToken?: string | null;
  ytRefreshToken?: string | null;
  ytTokenExpiresAt?: string | Date | null;
  ytScope?: string | null;
  ytTokenType?: string | null;
  ytRedirectUri?: string | null;
};

export function liveYouTubeRedirectUri(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.origin}/api/oauth/youtube/callback`;
}

function expiresKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function waitForYouTubeToken(options: {
  signal?: AbortSignal;
  previousExpiresAt?: string | Date | null;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<YouTubeTokenSnapshot | null> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const previous = expiresKey(options.previousExpiresAt);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    const res = await fetchImpl("/api/settings", { cache: "no-store", ...(options.signal ? { signal: options.signal } : {}) });
    const json = (await res.json()) as { settings?: YouTubeTokenSnapshot };
    options.signal?.throwIfAborted();
    const settings = json.settings;
    const nextExpiry = expiresKey(settings?.ytTokenExpiresAt);
    if (settings?.ytAccessToken && nextExpiry && nextExpiry !== previous) {
      return settings;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { options.signal?.removeEventListener("abort", cancel); resolve(); };
      const timer = setTimeout(finish, Math.min(intervalMs, remaining));
      const cancel = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
    });
  }
  return null;
}
