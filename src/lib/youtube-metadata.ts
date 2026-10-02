export type VideoAvailability = "available" | "deleted" | "private" | "unavailable" | "unknown";

export type YouTubeItemMetadata = {
  authorName?: string;
  authorUsername?: string;
  uploaderChannelId?: string;
  createdAt?: Date;
  playlistAddedAt?: Date;
  availability: VideoAvailability;
};

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function availabilityFromTitle(title: unknown): VideoAvailability {
  const value = clean(title)?.toLowerCase();
  if (value === "deleted video") return "deleted";
  if (value === "private video") return "private";
  if (value === "unavailable video") return "unavailable";
  if (!value) return "unknown";
  return "available";
}

/** Playlist item channel and publishedAt are the playlist, not the video. */
export function metadataFromPlaylistItem(entry: {
  snippet?: Record<string, unknown>;
  contentDetails?: Record<string, unknown>;
}): YouTubeItemMetadata {
  const snippet = entry.snippet ?? {};
  const details = entry.contentDetails ?? {};
  const author = clean(snippet.videoOwnerChannelTitle);
  return {
    authorName: author,
    authorUsername: author,
    uploaderChannelId: clean(snippet.videoOwnerChannelId),
    createdAt: parseDate(details.videoPublishedAt),
    playlistAddedAt: parseDate(snippet.publishedAt),
    availability: availabilityFromTitle(snippet.title),
  };
}

export function metadataFromStoredRaw(rawJson: string | null): YouTubeItemMetadata | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as { item?: { snippet?: Record<string, unknown>; contentDetails?: Record<string, unknown> } };
    if (!parsed.item) return null;
    return metadataFromPlaylistItem(parsed.item);
  } catch {
    return null;
  }
}

export function allowsConfidentDigest(input: {
  availability?: string | null;
  transcript?: string | null;
}) {
  const blocked = input.availability === "deleted" || input.availability === "private" || input.availability === "unavailable";
  if (!blocked) return { ok: true as const };
  if (input.transcript?.trim()) {
    return { ok: true as const, limited: true as const };
  }
  return {
    ok: false as const,
    reason: "This video is unavailable. No transcript was captured, so a confident summary was not created from the title.",
  };
}
