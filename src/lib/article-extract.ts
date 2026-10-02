import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { fetchPublicWeb, publicWebUrl, type WebTransport } from "./public-web";
import { captureTranscriptJson, type TranscriptCapture } from "./youtubeTranscript";

export function isExternalContentUrl(value: string) {
  try {
    const url = publicWebUrl(value);
    return !/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(url.hostname);
  } catch { return false; }
}
/** Compatibility preview only. Source processing uses all retained sections. */
export function boundSourceText(text: string, budget = 8000) {
  if (text.length <= budget) return { text, status: "complete" as const };
  const marker = "\n[middle omitted in preview]\n";
  const half = Math.max(1, Math.floor((budget - marker.length) / 2));
  return { text: text.slice(0, half) + marker + text.slice(-half), status: "partial" as const };
}
export function extractArticle(html: string, url: string) {
  // JSDOM executes no scripts and loads no external resources by default.
  const dom = new JSDOM(html, { url });
  try {
    const document = dom.window.document;
    const language = document.documentElement.lang || null;
    const article = new Readability(document, { charThreshold: 80, maxElemsToParse: 50_000 }).parse();
    const text = article?.textContent?.replace(/\s+/g, " ").trim();
    if (!text || text.length < 80) throw new Error("No readable article body was found. The page may require login or JavaScript.");
    return { text, language };
  } finally { dom.window.close(); }
}
export type ArticleCapture = { method: "article"; url: string; language: string | null; capture: TranscriptCapture; status: TranscriptCapture["status"]; text?: string; reason: string | null; capturedAt: string };
export async function fetchArticleCapture(value: string, options: { signal?: AbortSignal; transport?: WebTransport } = {}): Promise<ArticleCapture> {
  try {
    const response = await fetchPublicWeb(value, options);
    const contentType = response.headers.contentType?.split(";")[0].trim().toLowerCase();
    if (contentType && !["text/html", "application/xhtml+xml", "text/plain"].includes(contentType)) throw new Error("This source is not a supported text or HTML article.");
    const extracted = contentType === "text/plain" ? { text: response.text.trim(), language: null } : extractArticle(response.text, response.url);
    const capture = captureTranscriptJson({ events: [{ segs: [{ utf8: extracted.text }] }] });
    return { method: "article", url: response.url, language: extracted.language, capture, status: capture.status, text: capture.sections.map((section) => section.text).join("\n"), reason: capture.reason, capturedAt: capture.capturedAt };
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    const capture: TranscriptCapture = { status: "missing", reason: error instanceof Error ? error.message : "Article capture failed.", capturedAt: new Date().toISOString(), sections: [], totalCharacters: 0, storedCharacters: 0 };
    return { method: "article", url: value, language: null, capture, status: capture.status, reason: capture.reason, capturedAt: capture.capturedAt };
  }
}
export async function buildExternalSourceText(urls?: string[], signal?: AbortSignal) {
  const captures: ArticleCapture[] = [];
  for (const url of (urls ?? []).filter(isExternalContentUrl).slice(0, 2)) captures.push(await fetchArticleCapture(url, { signal }));
  const text = captures.map((entry) => entry.text).filter(Boolean).join("\n---\n");
  return captures.length ? { text: text || undefined, captures } : undefined;
}
