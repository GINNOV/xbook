export const YOUTUBE_CALLBACK_PATH = "/api/oauth/youtube/callback";

export function youtubeCallbackUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${YOUTUBE_CALLBACK_PATH}`;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Prefer the live server when a stored loopback URI points at a dead/other port. */
export function resolveLoopbackRedirectUri(
  stored: string | null | undefined,
  envUri: string | null | undefined,
  origin: string,
): string {
  const fallback = youtubeCallbackUri(origin);
  const candidate = stored?.trim() || envUri?.trim() || fallback;
  try {
    const chosen = new URL(candidate);
    const live = new URL(origin);
    if (
      isLoopbackHost(chosen.hostname) &&
      isLoopbackHost(live.hostname) &&
      effectivePort(chosen) !== effectivePort(live)
    ) {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return candidate;
}
