const MAX_BYTES = 200_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

function isPublicHttp(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false;
    }
  }
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  return true;
}

export function isExternalContentUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith("x.com") || host.endsWith("twitter.com") || host.endsWith("t.co")) return false;
    return isPublicHttp(parsed);
  } catch {
    return false;
  }
}

export type ArticleCapture = {
  method: "article";
  status: "complete" | "partial" | "missing";
  text?: string;
  reason?: string;
  capturedAt: string;
};

function htmlToText(html: string) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep the start and the end so a fact near the tail is not dropped. */
export function boundSourceText(text: string, budget = 8_000) {
  if (text.length <= budget) return { text, status: "complete" as const };
  const marker = "\n\n[middle omitted; beginning and end retained]\n\n";
  const half = Math.max(1, Math.floor((budget - marker.length) / 2));
  return {
    text: `${text.slice(0, half)}${marker}${text.slice(-half)}`,
    status: "partial" as const,
  };
}

export async function fetchArticleCapture(url: string, fetchImpl: typeof fetch = fetch): Promise<ArticleCapture> {
  const capturedAt = new Date().toISOString();
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { method: "article", status: "missing", reason: "Invalid URL.", capturedAt };
  }
  if (!isPublicHttp(current)) {
    return { method: "article", status: "missing", reason: "Only public http(s) destinations are fetched.", capturedAt };
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "XBook/1.0" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { method: "article", status: "missing", reason: "Redirect had no destination.", capturedAt };
        const next = new URL(location, current);
        if (!isPublicHttp(next)) {
          return { method: "article", status: "missing", reason: "Redirect left the public web.", capturedAt };
        }
        current = next;
        continue;
      }
      if (!response.ok) {
        return { method: "article", status: "missing", reason: `Page returned HTTP ${response.status}.`, capturedAt };
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (size < MAX_BYTES) {
          const step = await reader.read();
          if (step.done) break;
          size += step.value.byteLength;
          chunks.push(step.value);
        }
        await reader.cancel().catch(() => undefined);
      } else {
        const buffered = new Uint8Array(await response.arrayBuffer());
        chunks.push(buffered.subarray(0, MAX_BYTES));
        size = buffered.byteLength;
      }
      const html = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).subarray(0, MAX_BYTES));
      const text = htmlToText(html);
      if (!text) return { method: "article", status: "missing", reason: "Page had no readable text.", capturedAt };
      const bounded = boundSourceText(text);
      return { method: "article", status: bounded.status, text: bounded.text, capturedAt };
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "Page timed out." : "Page could not be fetched.";
      return { method: "article", status: "missing", reason, capturedAt };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { method: "article", status: "missing", reason: "Too many redirects.", capturedAt };
}

export async function buildExternalSourceText(urls?: string[]) {
  if (!urls?.length) return undefined;
  const captures = [];
  for (const url of urls.filter(isExternalContentUrl).slice(0, 2)) {
    const capture = await fetchArticleCapture(url);
    if (capture.text) captures.push(capture);
  }
  if (!captures.length) return undefined;
  return {
    text: captures.map((capture) => capture.text).join("\n---\n"),
    captures,
  };
}
