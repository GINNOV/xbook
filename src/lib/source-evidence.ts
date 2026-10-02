import { z } from "zod";
import { readCapturedSource, type CapturedSource } from "./capture-contract";
export { readCapturedSource, capturedSourceSchema, type CapturedSource } from "./capture-contract";
import { buildExternalSourceText } from "./article-extract";
import { allowsConfidentDigest, readYouTubeRaw } from "./youtube-metadata";
import { captureTranscriptJson, fetchYouTubeTranscriptCaptureFromUrl, transcriptCaptureSchema, type TranscriptCapture, type TranscriptSection } from "@/lib/youtubeTranscript";

export const SOURCE_EVIDENCE_KEY = "xbookSourceEvidence";
export const ASK_EVIDENCE_CHARACTERS = 2400;
export const ASK_TOTAL_EVIDENCE_CHARACTERS = 9600;
const evidenceSchema = z.object({ version: z.literal(1), source: z.literal("youtube_transcript"), capture: transcriptCaptureSchema });
export type SourceEvidence = z.infer<typeof evidenceSchema>;

function providerMetadata(rawJson: string | null): Record<string, unknown> {
  if (!rawJson) return {};
  try {
    const parsed: unknown = JSON.parse(rawJson);
    const object = z.record(z.string(), z.unknown()).safeParse(parsed);
    if (object.success) return object.data;
  } catch { /* Preserve opaque provider data below. */ }
  return { xbookOriginalRawJson: rawJson };
}

export function withSourceEvidence(rawJson: string | null, capture: TranscriptCapture): string {
  return JSON.stringify({ ...providerMetadata(rawJson), [SOURCE_EVIDENCE_KEY]: { version: 1, source: "youtube_transcript", capture } satisfies SourceEvidence });
}

export function readSourceEvidence(rawJson: string | null, captureJson?: string | null): SourceEvidence | null {
  const stored = readCapturedSource(captureJson);
  if (stored) return { version: 1, source: "youtube_transcript", capture: stored.capture };
  const parsed = evidenceSchema.safeParse(providerMetadata(rawJson)[SOURCE_EVIDENCE_KEY]);
  return parsed.success ? parsed.data : null;
}

export function formatEvidenceTimestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatEvidenceSection(section: TranscriptSection): string {
  return `${section.startSeconds === null ? "[time unavailable]" : `[${formatEvidenceTimestamp(section.startSeconds)}]`} ${section.text}`;
}

/** Includes distributed sections and explicitly describes gaps to the summarizer. */
export function transcriptSummaryText(capture: TranscriptCapture): string | undefined {
  if (capture.status === "missing") return undefined;
  const selected: TranscriptSection[] = [];
  let used = 0;
  const count = Math.min(6, capture.sections.length);
  for (let index = 0; index < count; index++) {
    const section = capture.sections[Math.round(index * (capture.sections.length - 1) / Math.max(1, count - 1))];
    const text = formatEvidenceSection(section);
    if (used + text.length > 10000) break;
    selected.push(section);
    used += text.length;
  }
  const sampled = selected.length < capture.sections.length || capture.status === "partial";
  return [
    sampled ? "PARTIAL TRANSCRIPT EXCERPTS. Gaps remain; do not imply the full video was read." : "COMPLETE CAPTURED TRANSCRIPT.",
    ...selected.map(formatEvidenceSection),
  ].join("\n");
}

/** Shared single and bulk enrichment capture, separate from generated summaries. */
export async function captureBookmarkSourceEvidence(bookmark: {
  tweetUrl: string; rawJson: string | null; captureJson?: string | null; source?: string;
  text?: string | null; externalUrls?: string | null; availability?: string | null;
}, signal?: AbortSignal) {
  let capture: TranscriptCapture;
  let method: CapturedSource["method"] = "transcript";
  let language: string | null = null;
  let sourceUrls = [bookmark.tweetUrl];
  if (!bookmark.source || bookmark.source === "yt") {
    const prior = readSourceEvidence(bookmark.rawJson, bookmark.captureJson);
    const storedPrior = readCapturedSource(bookmark.captureJson);
    const unavailable = ["deleted", "private", "unavailable"].includes(bookmark.availability ?? "");
    capture = unavailable && prior?.capture.status !== "missing" && prior
      ? prior.capture : await fetchYouTubeTranscriptCaptureFromUrl(bookmark.tweetUrl, signal);
    if (prior && prior.capture.status !== "missing" && (unavailable || capture.status === "missing")) {
      const failedReason = capture.status === "missing" ? capture.reason : null;
      method = storedPrior?.method ?? "transcript";
      capture = failedReason ? { ...prior.capture, status: "partial", reason: `Fresh capture failed: ${failedReason} Retained earlier captured source from ${prior.capture.capturedAt}.` } : prior.capture;
    }
    language = capture.language ?? storedPrior?.language ?? null;
    if (capture.status === "missing") {
      const description = readYouTubeRaw(bookmark.rawJson)?.item?.snippet?.description;
      if (allowsConfidentDigest({ availability: bookmark.availability, description }).ok && description) {
        method = "description";
        capture = textCapture(description, "Transcript unavailable; this digest uses only the video description.");
      }
    }
  } else {
    let urls: string[] = [];
    try { urls = z.array(z.string()).parse(JSON.parse(bookmark.externalUrls ?? "[]")); } catch { urls = (bookmark.externalUrls ?? "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean); }
    const articles = await buildExternalSourceText(urls, signal);
    if (articles?.text) {
      method = "article"; language = articles.captures[0]?.language ?? null;
      sourceUrls = articles.captures.map((entry) => entry.url);
      const partial = articles.captures.some((entry) => entry.status !== "complete");
      capture = textCapture(articles.text, partial ? "Some linked sources were incomplete or unavailable." : undefined);
    } else {
      const prior = readCapturedSource(bookmark.captureJson);
      if (urls.length && prior?.method === "article" && prior.capture.status !== "missing") {
        method = "article"; language = prior.language; sourceUrls = prior.sourceUrls;
        capture = { ...prior.capture, status: "partial", reason: `Fresh linked article capture failed. Retained earlier captured source from ${prior.capture.capturedAt}.` };
      } else {
        method = "post";
        capture = textCapture(bookmark.text ?? "", urls.length ? "Linked article capture unavailable; only the original post is available." : undefined);
      }
    }
  }
  const stored: CapturedSource = { version: 2, method: capture.status === "missing" ? "missing" : method, language, sourceUrls, capture };
  const eligibility = !bookmark.source || bookmark.source === "yt" ? allowsConfidentDigest({ availability: bookmark.availability,
    transcript: method === "transcript" && capture.status !== "missing" ? capture.sections.map((section) => section.text).join(" ") : null,
    description: method === "description" && capture.status !== "missing" ? capture.sections.map((section) => section.text).join(" ") : null }) : { ok: capture.status !== "missing" };
  return { capture, eligible: eligibility.ok, blockedReason: "reason" in eligibility ? eligibility.reason : capture.reason,
    rawJson: bookmark.rawJson, captureJson: JSON.stringify(stored), sections: capture.sections,
    method: stored.method, sourceText: capture.status === "missing" ? undefined : [
      `${stored.method.toUpperCase()} CAPTURE (${capture.status}). ${capture.reason ?? "All retained source sections supplied."}`,
      ...capture.sections.map(formatEvidenceSection),
    ].join("\n") };
}

export function textCapture(text: string, reason?: string): TranscriptCapture {
  const capture = captureTranscriptJson({ events: [{ segs: [{ utf8: text }] }] });
  return reason && capture.status !== "missing" ? { ...capture, status: "partial", reason: [reason, capture.reason].filter(Boolean).join(" ") } : capture;
}

export function questionTerms(question: string) {
  const stopWords = new Set(["the", "and", "what", "which", "where", "when", "does", "did", "was", "were", "how", "about", "this", "that", "with", "from", "for", "video", "transcript"]);
  return Array.from(new Set(question.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_]{3,}/gu) ?? [])).filter((term) => !stopWords.has(term));
}

/** Rank stored source passages using the question, with an explicit per-item budget. */
export function selectQuestionEvidence(rawJson: string | null, question: string, budget = ASK_EVIDENCE_CHARACTERS, captureJson?: string | null): TranscriptSection[] {
  const evidence = readSourceEvidence(rawJson, captureJson);
  if (!evidence || evidence.capture.status === "missing" || !Number.isFinite(budget) || budget <= 0) return [];
  const terms = questionTerms(question);
  const weights = terms.map((term) => ({
    term, weight: 1 + Math.log((evidence.capture.sections.length + 1) /
      (1 + evidence.capture.sections.filter((section) => section.text.toLowerCase().includes(term)).length)),
  }));
  const ranked = evidence.capture.sections.map((section, index) => {
    const text = section.text.toLowerCase();
    return { section, index, score: weights.reduce((score, { term, weight }) => score + (text.includes(term) ? weight : 0), 0) };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: TranscriptSection[] = [];
  let remaining = Math.min(ASK_EVIDENCE_CHARACTERS, Math.floor(budget));
  for (const { section } of ranked) {
    const headerLength = formatEvidenceSection({ ...section, text: "" }).length + 1;
    const available = remaining - headerLength;
    if (available <= 0) break;
    const match = terms.reduce((earliest, term) => {
      const index = section.text.toLowerCase().indexOf(term);
      return index < 0 ? earliest : Math.min(earliest, index);
    }, section.text.length);
    const offset = Math.min(Math.max(0, match - Math.floor(available / 3)), Math.max(0, section.text.length - available));
    const text = section.text.slice(offset, offset + available);
    selected.push({ ...section, text });
    remaining -= text.length + headerLength;
  }
  return selected;
}
