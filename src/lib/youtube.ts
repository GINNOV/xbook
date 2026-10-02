import { readProviderJson } from "./provider-response";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { requestOAuthTokens, saveRefreshedTokens } from "./oauth-tokens";
import { metadataFromPlaylistItem } from "@/lib/youtube-metadata";

const envSchema = z.object({ YT_CLIENT_ID: z.string().min(1).optional(), YT_CLIENT_SECRET: z.string().min(1).optional() });
const cleanEnv = (v?: string) => (v?.trim().length ? v.trim() : undefined);
type YtAuthContext = { accessToken: string };
export type YouTubePlaylist = { id: string; title?: string; itemCount?: number };
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type YouTubeBookmark = {
  id: string; tweetUrl: string; title?: string; text?: string;
  authorName?: string; authorUsername?: string; createdAt?: Date;
  likeCount?: number; replyCount?: number; retweetCount?: number; quoteCount?: number;
  lang?: string; folderId?: string; folderName?: string;
  externalUrls?: string[]; mediaDescription?: string; mediaJson?: string; rawJson: string;
  uploaderChannelId?: string; playlistAddedAt?: Date; availability?: string;
};

export async function getAuthContext(signal?: AbortSignal): Promise<YtAuthContext> {
  signal?.throwIfAborted();
  const env = envSchema.parse({ YT_CLIENT_ID: cleanEnv(process.env.YT_CLIENT_ID), YT_CLIENT_SECRET: cleanEnv(process.env.YT_CLIENT_SECRET) });
  const settings = await getSettings();
  let token = settings.ytAccessToken ?? null;
  const expiry = settings.ytTokenExpiresAt?.getTime();
  const needsRefresh = !token || (expiry !== undefined && Date.now() >= expiry - 120000);
  const clientId = settings.ytClientId ?? env.YT_CLIENT_ID;
  const clientSecret = settings.ytClientSecret ?? env.YT_CLIENT_SECRET;
  if (needsRefresh && settings.ytRefreshToken && clientId && clientSecret) {
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: settings.ytRefreshToken, grant_type: "refresh_token" });
    const tokens = await requestOAuthTokens(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, signal);
    token = await saveRefreshedTokens("yt", tokens, settings, signal);
  } else if (expiry !== undefined && Date.now() >= expiry) {
    throw new Error("YouTube authorization expired. Reconnect in Settings → Connections.");
  }
  signal?.throwIfAborted();
  if (!token) throw new Error("Missing YouTube credentials. Connect YouTube in Settings → Connections.");
  return { accessToken: token };
}

async function fetchWithAuth(url: URL, accessToken: string, signal?: AbortSignal) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (res.ok) return readProviderJson(res) as Promise<Record<string, any>>;
  const text = await res.text();
  if (res.status === 403 && (text.toLowerCase().includes("quotaexceeded") || text.toLowerCase().includes("dailylimitexceeded"))) {
    const error = new Error("YouTube API quota reached.");
    (error as any).code = "YOUTUBE_QUOTA";
    throw error;
  }
  throw new Error(`YouTube API error ${res.status}: ${text}`);
}

async function fetchAllPlaylists(accessToken: string): Promise<YouTubePlaylist[]> {
  const playlists: YouTubePlaylist[] = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const json = (await fetchWithAuth(url, accessToken)) as any;
    for (const item of json.items ?? []) {
      if (item.id) playlists.push({ id: item.id, title: item.snippet?.title, itemCount: item.contentDetails?.itemCount ?? 0 });
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return playlists;
}

export async function fetchYouTubePlaylists() {
  const { accessToken } = await getAuthContext();
  return fetchAllPlaylists(accessToken);
}

function mapItem(entry: any, playlist: YouTubePlaylist) {
  const snip = entry.snippet;
  const vid = snip?.resourceId?.videoId;
  if (!vid) return null;
  const url = `https://www.youtube.com/watch?v=${vid}`;
  const txt = snip?.title && snip?.description ? `${snip.title}\n\n${snip.description}` : (snip?.title || snip?.description);
  const metadata = metadataFromPlaylistItem(entry);
  return {
    id: `yt:${playlist.id}:${vid}`, tweetUrl: url, title: snip?.title, text: txt,
    authorName: metadata.authorName, authorUsername: metadata.authorUsername,
    createdAt: metadata.createdAt,
    uploaderChannelId: metadata.uploaderChannelId,
    playlistAddedAt: metadata.playlistAddedAt,
    availability: metadata.availability,
    folderId: `yt:pl:${playlist.id}`, folderName: playlist.title, externalUrls: [url],
    rawJson: JSON.stringify({ playlistId: playlist.id, playlistTitle: playlist.title, item: entry }),
  } satisfies YouTubeBookmark;
}

async function fetchPlaylistPage(playlistId: string, token: string, size: number, pageToken?: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", String(size));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return (await fetchWithAuth(url, token)) as any;
}

export async function fetchYouTubeBookmarks(input?: { maxTotal?: number }) {
  const { accessToken } = await getAuthContext();
  const playlists = await fetchAllPlaylists(accessToken);
  const max = input?.maxTotal ?? Number.POSITIVE_INFINITY;
  const items: YouTubeBookmark[] = [];
  for (const pl of playlists) {
    if (items.length >= max) break;
    let pt: string | undefined;
    while (items.length < max) {
      const json = await fetchPlaylistPage(pl.id, accessToken, Math.min(50, max - items.length), pt);
      for (const entry of json.items ?? []) {
        const item = mapItem(entry, pl);
        if (item && items.length < max) items.push(item);
      }
      if (!json.nextPageToken) break;
      pt = json.nextPageToken;
    }
  }
  return items;
}

export async function validateYouTubeImportClient(provider?: { accountFingerprint?: string }) {
  if (!provider?.accountFingerprint) return;
  const settings = await getSettings();
  const fingerprint = `client:${createHash("sha256").update(JSON.stringify([settings.ytClientId ?? cleanEnv(process.env.YT_CLIENT_ID) ?? ""])).digest("hex")}`;
  // An older token fingerprint cannot prove a stable client or owner.
  if (!provider.accountFingerprint.startsWith("client:")) throw new Error("YouTube configuration changed: this older import needs a new stable account checkpoint. Start a new import.");
  if (fingerprint !== provider.accountFingerprint) throw new Error("YouTube configuration changed. Start a new operation for the reconnected account.");
}

function playlistOwner(entries: unknown[], pinned?: string) {
  const owners = entries.map((entry) => z.object({ snippet: z.object({ channelId: z.string().min(1) }) }).safeParse(entry));
  if (owners.some((owner) => !owner.success)) throw new Error("YouTube configuration changed: playlist owner is missing from the provider response.");
  const ids = new Set(owners.flatMap((owner) => owner.success ? [owner.data.snippet.channelId] : []));
  if (ids.size > 1 || (pinned && [...ids].some((id) => id !== pinned))) throw new Error("YouTube configuration changed: playlist owner does not match this import.");
  return [...ids][0];
}

export async function fetchYouTubeImportFolders(cursor: string | null, signal: AbortSignal, provider?: { accountFingerprint?: string; ownerId?: string }) {
  signal.throwIfAborted(); await validateYouTubeImportClient(provider); const { accessToken } = await getAuthContext(signal); signal.throwIfAborted();
  const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
  url.searchParams.set("part", "snippet,contentDetails"); url.searchParams.set("mine", "true"); url.searchParams.set("maxResults", "50");
  if (cursor) url.searchParams.set("pageToken", cursor);
  const page = z.object({ items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string().optional(), channelId: z.string().optional() }).optional() })).optional(), nextPageToken: z.string().optional() }).parse(await fetchWithAuth(url, accessToken, signal));
  const ownerId = playlistOwner(page.items ?? [], provider?.ownerId);
  return { folders: (page.items ?? []).map((playlist) => ({ id: `yt:pl:${playlist.id}`, name: playlist.snippet?.title ?? playlist.id })), nextCursor: page.nextPageToken ?? null, ownerId };
}
export async function fetchYouTubeImportPage(input: { folderId: string; folderName: string; cursor: string | null; signal: AbortSignal; provider?: { accountFingerprint?: string; ownerId?: string } }) {
  input.signal.throwIfAborted(); await validateYouTubeImportClient(input.provider); const { accessToken } = await getAuthContext(input.signal); input.signal.throwIfAborted();
  const playlistId = input.folderId.replace(/^yt:pl:/, "");
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet,contentDetails"); url.searchParams.set("playlistId", playlistId); url.searchParams.set("maxResults", "50");
  if (input.cursor) url.searchParams.set("pageToken", input.cursor);
  const page = z.object({ items: z.array(z.unknown()).optional(), nextPageToken: z.string().optional() }).parse(await fetchWithAuth(url, accessToken, input.signal));
  const ownerId = playlistOwner(page.items ?? [], input.provider?.ownerId);
  const items = (page.items ?? []).map((entry) => mapItem(entry, { id: playlistId, title: input.folderName })).filter((entry): entry is NonNullable<typeof entry> => !!entry);
  return { ids: items.map((entry) => entry.id), items, nextCursor: page.nextPageToken ?? null, unavailable: (page.items?.length ?? 0) - items.length, ownerId };
}
