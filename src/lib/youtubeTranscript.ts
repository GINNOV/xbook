import { z } from "zod";

import { TRANSCRIPT_SECTION_CHARACTERS, TRANSCRIPT_MAX_SECTIONS, type TranscriptCapture, type TranscriptSection } from "./transcript-contract";
export { TRANSCRIPT_SECTION_CHARACTERS, TRANSCRIPT_MAX_SECTIONS, transcriptCaptureSchema, type TranscriptCapture, type TranscriptSection } from "./transcript-contract";
import { fetchPublicWeb, publicWebTransport } from "./public-web";

const captionEventSchema = z.object({
  tStartMs: z.number().finite().nonnegative().optional(),
  dDurationMs: z.number().finite().nonnegative().optional(),
  segs: z.array(z.object({ utf8: z.string().optional() })).optional(),
});
const playerSchema = z.object({
  captions: z.object({
    playerCaptionsTracklistRenderer: z.object({
      captionTracks: z.array(z.object({ baseUrl: z.string().url(), languageCode: z.string().optional() })),
    }),
  }).optional(),
});

function missingCapture(reason: string): TranscriptCapture {
  return { status: "missing", reason, capturedAt: new Date().toISOString(), sections: [], totalCharacters: 0, storedCharacters: 0 };
}

/** Bound retained evidence across the full timeline rather than cutting its prefix. */
export function captureTranscriptJson(json: unknown): TranscriptCapture {
  const envelope = z.object({ events: z.array(z.unknown()) }).safeParse(json);
  if (!envelope.success) return missingCapture("Caption response has no usable events.");
  const sections: TranscriptSection[] = [];
  let malformed = false;
  for (const rawEvent of envelope.data.events) {
    const parsed = captionEventSchema.safeParse(rawEvent);
    if (!parsed.success) { malformed = true; continue; }
    const event = parsed.data;
    const text = (event.segs ?? []).map((segment) => segment.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const startSeconds = event.tStartMs === undefined ? null : event.tStartMs / 1000;
    const endSeconds = startSeconds === null || event.dDurationMs === undefined ? null : startSeconds + event.dDurationMs / 1000;
    let remaining = text;
    while (remaining.length) {
      let size = Math.min(remaining.length, TRANSCRIPT_SECTION_CHARACTERS);
      if (size < remaining.length) {
        const boundary = remaining.lastIndexOf(" ", size);
        if (boundary > 0) size = boundary;
      }
      const part = remaining.slice(0, size).trim();
      remaining = remaining.slice(size).trimStart();
      const previous = sections[sections.length - 1];
      if (previous && previous.text.length + part.length + 1 <= TRANSCRIPT_SECTION_CHARACTERS) {
        previous.text += ` ${part}`;
        previous.endSeconds = endSeconds;
      } else {
        sections.push({ text: part, startSeconds, endSeconds });
      }
    }
  }
  if (!sections.length) return missingCapture("No caption text was available.");
  const totalCharacters = sections.reduce((total, section) => total + section.text.length, 0);
  const retained = sections.length <= TRANSCRIPT_MAX_SECTIONS ? sections : Array.from(
    { length: TRANSCRIPT_MAX_SECTIONS },
    (_, index) => sections[Math.round(index * (sections.length - 1) / (TRANSCRIPT_MAX_SECTIONS - 1))]
  );
  const fields = {
    capturedAt: new Date().toISOString(), sections: retained, totalCharacters,
    storedCharacters: retained.reduce((total, section) => total + section.text.length, 0),
  };
  if (retained.length !== sections.length || malformed) {
    return { ...fields, status: "partial", reason: retained.length !== sections.length
      ? "Transcript exceeds the storage budget; sampled sections include the beginning and end."
      : "Some caption events could not be parsed." };
  }
  return { ...fields, status: "complete", reason: null };
}

function extractVideoId(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be" || host === "www.youtu.be") return parsed.pathname.split("/")[1] || null;
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
    return parsed.searchParams.get("v")?.trim() || null;
  } catch { return null; }
}

export const TRANSCRIPT_NETWORK_BYTE_LIMIT = 2 * 1024 * 1024;

async function fetchWithTimeout(url: string, signal?: AbortSignal) {
  const response = await fetchPublicWeb(url, { signal, byteLimit: TRANSCRIPT_NETWORK_BYTE_LIMIT, transport: publicWebTransport });
  return { ok: true, text: response.text };
}

export async function fetchYouTubeTranscriptCaptureFromUrl(videoUrl: string, signal?: AbortSignal): Promise<TranscriptCapture> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return missingCapture("Invalid YouTube video URL.");
  try {
    const response = await fetchWithTimeout(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, signal);
    if (!response.ok) return missingCapture("YouTube video page was unavailable.");
    const match = response.text.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
    if (!match?.[1]) return missingCapture("YouTube caption metadata was unavailable.");
    const player = playerSchema.safeParse(JSON.parse(match[1]));
    if (!player.success) return missingCapture("YouTube caption metadata could not be parsed.");
    const tracks = player.data.captions?.playerCaptionsTracklistRenderer.captionTracks ?? [];
    const track = tracks.find((entry) => entry.languageCode?.startsWith("en")) ?? tracks[0];
    if (!track) return missingCapture("No caption track was available.");
    const captionUrl = new URL(track.baseUrl);
    if (captionUrl.protocol !== "https:" || !/(^|\.)(youtube\.com|googlevideo\.com|google\.com)$/.test(captionUrl.hostname) || captionUrl.username || captionUrl.password) return missingCapture("Caption destination is not a supported YouTube source.");
    captionUrl.searchParams.set("fmt", "json3");
    const captions = await fetchWithTimeout(captionUrl.toString(), signal);
    if (!captions.ok) return missingCapture("YouTube captions could not be downloaded.");
    return { ...captureTranscriptJson(JSON.parse(captions.text)), language: track.languageCode ?? null };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return missingCapture(error instanceof Error ? error.message : "YouTube caption capture failed or timed out.");
  }
}

/** Compatibility adapter for callers that still expect bounded plain text. */
export async function fetchYouTubeTranscriptFromUrl(videoUrl: string): Promise<string | null> {
  const capture = await fetchYouTubeTranscriptCaptureFromUrl(videoUrl);
  return capture.status === "missing" ? null : capture.sections.map((section) => section.text).join(" ").slice(0, 12000);
}
