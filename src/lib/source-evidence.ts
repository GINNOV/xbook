import { z } from "zod";
import { fetchYouTubeTranscriptCaptureFromUrl, transcriptCaptureSchema, type TranscriptCapture, type TranscriptSection } from "@/lib/youtubeTranscript";

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

export function readSourceEvidence(rawJson: string | null): SourceEvidence | null {
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
export async function captureBookmarkSourceEvidence(bookmark: { tweetUrl: string; rawJson: string | null }, signal?: AbortSignal) {
  const capture = await fetchYouTubeTranscriptCaptureFromUrl(bookmark.tweetUrl, signal);
  return { capture, rawJson: withSourceEvidence(bookmark.rawJson, capture), sourceText: transcriptSummaryText(capture) };
}

/** Rank stored source passages using the question, with an explicit per-item budget. */
export function selectQuestionEvidence(rawJson: string | null, question: string, budget = ASK_EVIDENCE_CHARACTERS): TranscriptSection[] {
  const evidence = readSourceEvidence(rawJson);
  if (!evidence || evidence.capture.status === "missing" || !Number.isFinite(budget) || budget <= 0) return [];
  const stopWords = new Set(["the", "and", "what", "which", "where", "when", "does", "did", "was", "were", "how", "about", "this", "that", "with", "from", "for", "video", "transcript"]);
  const terms = Array.from(new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])).filter((term) => !stopWords.has(term));
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
