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

const UNSPECIFIED_HOSTS = new Set(["0.0.0.0", "::", "::0"]);

function firstHeader(value: string | null): string {
  return value?.split(",")[0]?.trim() ?? "";
}

function splitHost(host: string): { hostname: string; port: string } {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end !== -1) {
      const rest = host.slice(end + 1);
      return {
        hostname: host.slice(1, end),
        port: rest.startsWith(":") ? rest.slice(1) : "",
      };
    }
  }
  const colon = host.lastIndexOf(":");
  if (colon > 0 && host.indexOf(":") === colon) {
    return { hostname: host.slice(0, colon), port: host.slice(colon + 1) };
  }
  return { hostname: host, port: "" };
}

/**
 * Origin the browser used. `request.url` is the listen address when the
 * server binds 0.0.0.0, and that address is not a place to send the user.
 */
export function requestPublicOrigin(request: Pick<Request, "url" | "headers">): string {
  const url = new URL(request.url);
  const forwardedHost = firstHeader(request.headers.get("x-forwarded-host"));
  const hostHeader = firstHeader(request.headers.get("host"));
  const rawHost = forwardedHost || hostHeader || url.host;
  const proto = firstHeader(request.headers.get("x-forwarded-proto")) || url.protocol.replace(/:$/, "");
  const parsed = splitHost(rawHost);
  const unspecified = UNSPECIFIED_HOSTS.has(parsed.hostname);
  const hostname = unspecified ? "localhost" : parsed.hostname;
  const port = parsed.port || (unspecified ? url.port : "");
  const omitPort =
    !port || (proto === "http" && port === "80") || (proto === "https" && port === "443");
  const formatted = hostname.includes(":") ? `[${hostname}]` : hostname;
  return omitPort ? `${proto}://${formatted}` : `${proto}://${formatted}:${port}`;
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
