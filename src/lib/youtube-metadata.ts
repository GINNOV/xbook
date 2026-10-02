import { z } from "zod";

export type VideoAvailability = "available" | "deleted" | "private" | "unavailable" | "unknown";
export type YouTubeItemMetadata = {
  authorName?: string;
  authorUsername?: string;
  uploaderChannelId?: string;
  createdAt?: Date;
  playlistAddedAt?: Date;
  availability: VideoAvailability;
};

const text = z.string().optional().catch(undefined);
export const playlistItemSchema = z.object({
  snippet: z.object({
    title: text, description: text, publishedAt: text,
    videoOwnerChannelTitle: text, videoOwnerChannelId: text,
    resourceId: z.object({ videoId: text }).passthrough().optional(),
  }).passthrough().optional(),
  contentDetails: z.object({ videoPublishedAt: text, videoId: text }).passthrough().optional(),
}).passthrough();
export const videoMetadataSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({ channelTitle: text, channelId: text, publishedAt: text, title: text, description: text }).passthrough(),
}).passthrough();
export type AuthoritativeVideoMetadata = z.infer<typeof videoMetadataSchema>;
const cacheSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), kind: z.literal("found"), video: videoMetadataSchema }),
  z.object({ version: z.literal(1), kind: z.literal("missing") }),
]);
const rawSchema = z.object({ item: playlistItemSchema.optional().catch(undefined), xbookVideoMetadata: z.unknown().optional() }).passthrough();

function clean(value: string | undefined) { return value?.trim() || undefined; }
function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
export function availabilityFromTitle(title: unknown): VideoAvailability {
  const value = typeof title === "string" ? title.trim().toLowerCase() : undefined;
  if (value === "deleted video") return "deleted";
  if (value === "private video") return "private";
  if (value === "unavailable video") return "unavailable";
  return value ? "available" : "unknown";
}

/** Playlist item channel and publishedAt describe the playlist, not the video. */
export function metadataFromPlaylistItem(entry: unknown): YouTubeItemMetadata {
  const parsed = playlistItemSchema.safeParse(entry);
  if (!parsed.success) return { availability: "unknown" };
  const snippet = parsed.data.snippet;
  const author = clean(snippet?.videoOwnerChannelTitle);
  return {
    authorName: author, authorUsername: author,
    uploaderChannelId: clean(snippet?.videoOwnerChannelId),
    createdAt: parseDate(parsed.data.contentDetails?.videoPublishedAt),
    playlistAddedAt: parseDate(snippet?.publishedAt),
    availability: availabilityFromTitle(snippet?.title),
  };
}

export function readYouTubeRaw(rawJson: string | null) {
  if (!rawJson) return null;
  try {
    const parsed = rawSchema.safeParse(JSON.parse(rawJson));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function metadataFromStoredRaw(rawJson: string | null): YouTubeItemMetadata | null {
  const raw = readYouTubeRaw(rawJson);
  if (!raw) return null;
  const cached = cacheSchema.safeParse(raw.xbookVideoMetadata);
  if (!raw.item && !cached.success) return null;
  const metadata = metadataFromPlaylistItem(raw.item ?? {});
  if (!cached.success) return metadata;
  if (cached.data.kind === "missing") {
    return { ...metadata, availability: ["deleted", "private", "unavailable"].includes(metadata.availability) ? metadata.availability : "unavailable" };
  }
  const snippet = cached.data.video.snippet;
  const author = clean(snippet.channelTitle);
  return {
    ...metadata, authorName: author, authorUsername: author,
    uploaderChannelId: clean(snippet.channelId), createdAt: parseDate(snippet.publishedAt),
    availability: ["deleted", "private", "unavailable"].includes(metadata.availability) ? metadata.availability : "available",
  };
}

export function cachedVideoMetadata(rawJson: string | null) {
  const cache = cacheSchema.safeParse(readYouTubeRaw(rawJson)?.xbookVideoMetadata);
  return cache.success ? cache.data : null;
}
export function withVideoMetadata(rawJson: string | null, video: AuthoritativeVideoMetadata | null) {
  const cache: z.infer<typeof cacheSchema> = video ? { version: 1, kind: "found", video } : { version: 1, kind: "missing" };
  let original: Record<string, unknown> | null = null;
  try {
    const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(rawJson ?? "null"));
    if (parsed.success) original = parsed.data;
  } catch { /* Preserve malformed original data separately when adding the cache. */ }
  return JSON.stringify({ ...(original ?? { xbookOriginalRawJson: rawJson }), item: original?.item ?? {}, xbookVideoMetadata: cache });
}

export function allowsConfidentDigest(input: {
  availability?: string | null;
  transcript?: string | null;
  description?: string | null;
}) {
  const blocked = input.availability === "deleted" || input.availability === "private" || input.availability === "unavailable";
  if (input.transcript?.trim()) return { ok: true as const, limited: blocked };
  // A title or an empty description is not source evidence. Short captions such as
  // "subscribe" are not an adequate description fallback either.
  const description = input.description?.trim();
  if (!blocked && description && description.length >= 120 && description.split(/\s+/).length >= 20) {
    return { ok: true as const, limited: true as const };
  }
  return { ok: false as const, reason: blocked
    ? "This video is unavailable. Prior captured evidence remains readable; a fresh summary needs captured source evidence."
    : "No transcript or adequate description was captured. A confident summary cannot be created from a title alone." };
}
