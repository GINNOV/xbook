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
    const res = await fetchImpl("/api/settings", { cache: "no-store" });
    const json = (await res.json()) as { settings?: YouTubeTokenSnapshot };
    const settings = json.settings;
    const nextExpiry = expiresKey(settings?.ytTokenExpiresAt);
    if (settings?.ytAccessToken && nextExpiry && nextExpiry !== previous) {
      return settings;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  return null;
}
