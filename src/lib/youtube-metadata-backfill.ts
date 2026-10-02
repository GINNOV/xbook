import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { cachedVideoMetadata, metadataFromStoredRaw, readYouTubeRaw, videoMetadataSchema, withVideoMetadata, type AuthoritativeVideoMetadata } from "@/lib/youtube-metadata";

export class YouTubeMetadataProviderError extends Error {
  constructor(readonly reason: "quota" | "provider", message: string) { super(message); }
}
export type YouTubeMetadataProvider = (ids: string[]) => Promise<AuthoritativeVideoMetadata[]>;
const responseSchema = z.object({ items: z.array(videoMetadataSchema) });

/** videos.list costs one quota unit for a request with at most 50 distinct IDs. */
export function createYouTubeMetadataProvider(input: { accessToken: string; fetch?: typeof fetch; signal?: AbortSignal }): YouTubeMetadataProvider {
  return async (ids) => {
    const distinct = z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).min(1).max(50).parse([...new Set(ids)]);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet"); url.searchParams.set("id", distinct.join(","));
    const timeout = AbortSignal.timeout(10_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await (input.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${input.accessToken}` }, signal });
    if (!response.ok) {
      const body = await response.text();
      const quota = response.status === 403 && /quotaExceeded|dailyLimitExceeded/i.test(body);
      throw new YouTubeMetadataProviderError(quota ? "quota" : "provider", quota ? "YouTube metadata quota reached." : `YouTube metadata request failed (${response.status}).`);
    }
    return responseSchema.parse(await response.json()).items;
  };
}

const optionsSchema = z.object({
  afterId: z.string().nullable().default(null),
  maxItems: z.number().int().min(1).max(500).default(50),
  maxRequests: z.number().int().min(0).max(10).default(1),
  refresh: z.enum(["missing", "all"]).default("missing"),
});
type Counters = { afterId: string | null; scanned: number; updated: number; requests: number };
export type YouTubeMetadataBackfillResult = Counters & (
  { status: "completed" } | { status: "paused"; reason: "item_limit" | "request_limit" | "quota" | "provider" | "changed" | "stopped" }
);
function videoId(row: { tweetUrl: string; rawJson: string | null }) {
  const raw = readYouTubeRaw(row.rawJson);
  const fromRaw = raw?.item?.contentDetails?.videoId ?? raw?.item?.snippet?.resourceId?.videoId;
  if (fromRaw && /^[a-zA-Z0-9_-]+$/.test(fromRaw)) return fromRaw;
  try {
    const url = new URL(row.tweetUrl);
    if (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") {
      const id = url.searchParams.get("v");
      if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return id;
    }
  } catch { /* Invalid legacy URL has no authoritative video ID. */ }
  return null;
}

/** Return the last fully committed ID so a caller can persist and resume it. */
export async function backfillYouTubeMetadata(input: {
  database: Pick<PrismaClient, "bookmark">;
  provider?: YouTubeMetadataProvider;
  options?: z.input<typeof optionsSchema>;
  signal?: AbortSignal;
}): Promise<YouTubeMetadataBackfillResult> {
  const options = optionsSchema.parse(input.options ?? {});
  const counters: Counters = { afterId: options.afterId, scanned: 0, updated: 0, requests: 0 };
  while (counters.scanned < options.maxItems) {
    if (input.signal?.aborted) return { ...counters, status: "paused", reason: "stopped" };
    const rows = await input.database.bookmark.findMany({
      where: { source: "yt", ...(counters.afterId ? { id: { gt: counters.afterId } } : {}) },
      orderBy: { id: "asc" }, take: Math.min(50, options.maxItems - counters.scanned),
    });
    if (!rows.length) return { ...counters, status: "completed" };
    const needed = rows.filter((row) => {
      const metadata = metadataFromStoredRaw(row.rawJson);
      return videoId(row) && (options.refresh === "all" || (!cachedVideoMetadata(row.rawJson) && (!metadata?.uploaderChannelId || !metadata.createdAt || !metadata.authorName)));
    });
    const ids = [...new Set(needed.map(videoId).filter((id) => id !== null))];
    let videos: AuthoritativeVideoMetadata[] | null = null;
    let deferred: "request_limit" | "quota" | "provider" | null = null;
    if (ids.length && input.provider) {
      if (counters.requests >= options.maxRequests) deferred = "request_limit";
      else {
        counters.requests++;
        try { videos = z.array(videoMetadataSchema).parse(await input.provider(ids)); }
        catch (error) { deferred = error instanceof YouTubeMetadataProviderError ? error.reason : "provider"; }
      }
    }
    for (const row of rows) {
      if (input.signal?.aborted) return { ...counters, status: "paused", reason: "stopped" };
      const id = videoId(row);
      const needsRefresh = needed.some((entry) => entry.id === row.id);
      // Do not advance past deferred metadata work. Raw-only repairs already
      // committed before this row remain safe to resume from the cursor.
      if (needsRefresh && deferred) return { ...counters, status: "paused", reason: deferred };
      const rawJson = videos && id && needsRefresh
        ? withVideoMetadata(row.rawJson, videos.find((video) => video.id === id) ?? null) : row.rawJson;
      const metadata = metadataFromStoredRaw(rawJson);
      if (metadata) {
        const data = {
          authorName: metadata.authorName ?? null, authorUsername: metadata.authorUsername ?? null,
          uploaderChannelId: metadata.uploaderChannelId ?? null, createdAt: metadata.createdAt ?? null,
          playlistAddedAt: metadata.playlistAddedAt ?? null, availability: metadata.availability, rawJson,
        };
        const changed = row.authorName !== data.authorName || row.authorUsername !== data.authorUsername || row.uploaderChannelId !== data.uploaderChannelId
          || row.createdAt?.getTime() !== data.createdAt?.getTime() || row.playlistAddedAt?.getTime() !== data.playlistAddedAt?.getTime()
          || row.availability !== data.availability || row.rawJson !== rawJson;
        if (changed) {
          const result = await input.database.bookmark.updateMany({ where: { id: row.id, source: "yt", rawJson: row.rawJson }, data });
          if (!result.count) return { ...counters, status: "paused", reason: "changed" };
          counters.updated++;
        }
      }
      counters.scanned++; counters.afterId = row.id;
    }
  }
  const remaining = await input.database.bookmark.count({ where: { source: "yt", ...(counters.afterId ? { id: { gt: counters.afterId } } : {}) } });
  return remaining ? { ...counters, status: "paused", reason: "item_limit" } : { ...counters, status: "completed" };
}
