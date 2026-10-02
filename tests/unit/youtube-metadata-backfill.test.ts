// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { metadataFromPlaylistItem, metadataFromStoredRaw, allowsConfidentDigest, withVideoMetadata, type AuthoritativeVideoMetadata } from "@/lib/youtube-metadata";
import { createYouTubeMetadataRepairHandler } from "@/lib/youtube-metadata-api";
import { backfillYouTubeMetadata, createYouTubeMetadataProvider, YouTubeMetadataProviderError } from "@/lib/youtube-metadata-backfill";

let directory: string;
let database: PrismaClient;
const addition = "2025-05-01T12:00:00Z";
const publication = "2024-01-02T12:00:00Z";
function raw(id: string, title = "Useful video", complete = true) {
  return JSON.stringify({ playlistId: "mixed", playlistTitle: "Saved list", xbookSourceEvidence: { captured: "Prior evidence" }, item: {
    snippet: { title, channelTitle: "Playlist owner", publishedAt: addition, resourceId: { videoId: id },
      ...(complete ? { videoOwnerChannelTitle: `Uploader ${id}`, videoOwnerChannelId: `channel-${id}` } : {}) },
    contentDetails: { videoId: id, ...(complete ? { videoPublishedAt: publication } : {}) },
  } });
}
function video(id: string): AuthoritativeVideoMetadata {
  return { id, snippet: { title: "Useful video", channelTitle: `Authoritative ${id}`, channelId: `author-${id}`, publishedAt: publication } };
}
async function seed(id: string, complete = true, title?: string) {
  return database.bookmark.create({ data: {
    id, source: "yt", tweetUrl: `https://www.youtube.com/watch?v=${id}`, rawJson: raw(id, title, complete),
    authorName: "Playlist owner", authorUsername: "Playlist owner", createdAt: new Date(addition),
    summary: "Human correction", category: "Manual category", tags: "manual", editedAt: new Date(publication), readAt: new Date(publication),
    folderId: "yt:pl:mixed", captureJson: JSON.stringify({ evidence: "Kept capture" }), summarizedAt: new Date(publication), summarySource: "human",
  } });
}
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-youtube-metadata-"));
  const filename = path.join(directory, "fixture.db");
  const sqlite = new Database(filename);
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const filename = path.join("prisma/migrations", migration, "migration.sql");
    if (fs.existsSync(filename)) sqlite.exec(fs.readFileSync(filename, "utf8"));
  }
  sqlite.close();
  database = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: filename }) });
  await database.bookmarkFolder.create({ data: { id: "yt:pl:mixed", name: "Mixed uploaders" } });
});
afterEach(async () => { await database.$disconnect(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("YouTube historical metadata repair", () => {
  it("corrects each uploader/publication/addition from raw without provider calls and is stable twice", async () => {
    const before = await Promise.all([seed("alpha"), seed("beta")]);
    const provider = vi.fn(async (ids: string[]) => ids.map(video));
    expect(await backfillYouTubeMetadata({ database, provider })).toMatchObject({ status: "completed", updated: 2, requests: 0 });
    const after = await database.bookmark.findMany({ orderBy: { id: "asc" } });
    expect(after.map((row) => row.authorName)).toEqual(["Uploader alpha", "Uploader beta"]);
    for (const [index, row] of after.entries()) {
      expect(row.createdAt).toEqual(new Date(publication)); expect(row.playlistAddedAt).toEqual(new Date(addition));
      const original = before[index];
      expect(original).toBeDefined();
      expect(row).toMatchObject({ id: original.id, folderId: original.folderId, summary: original.summary, category: original.category, tags: original.tags,
        editedAt: original.editedAt, readAt: original.readAt, captureJson: original.captureJson, rawJson: original.rawJson, summarizedAt: original.summarizedAt, summarySource: "human" });
    }
    expect(await backfillYouTubeMetadata({ database, provider })).toMatchObject({ status: "completed", updated: 0, requests: 0 });
    expect(provider).not.toHaveBeenCalled();
  });
  it("clears unsupported playlist owner/publication rather than inventing missing values", async () => {
    await seed("unknown", false);
    await backfillYouTubeMetadata({ database });
    expect(await database.bookmark.findUnique({ where: { id: "unknown" } })).toMatchObject({ authorName: null, authorUsername: null, uploaderChannelId: null, createdAt: null, playlistAddedAt: new Date(addition) });
    expect(metadataFromStoredRaw('null')).toBeNull(); expect(metadataFromStoredRaw('{broken')).toBeNull();
    expect(metadataFromPlaylistItem({ snippet: { videoOwnerChannelTitle: 123, publishedAt: "invalid" } })).toMatchObject({ authorName: undefined, playlistAddedAt: undefined, availability: "unknown" });
  });
  it("batches duplicate video IDs once and retains raw capture/cache with stable authoritative repair", async () => {
    await seed("alpha", false); await seed("beta", false);
    await database.bookmark.create({ data: { id: "another-playlist-alpha", source: "yt", tweetUrl: "https://www.youtube.com/watch?v=alpha", rawJson: raw("alpha", "Useful video", false), folderId: "yt:pl:mixed" } });
    const provider = vi.fn(async (ids: string[]) => ids.map(video));
    expect(await backfillYouTubeMetadata({ database, provider })).toMatchObject({ status: "completed", requests: 1, updated: 3 });
    expect(provider).toHaveBeenCalledWith(["alpha", "beta"]);
    const row = await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } });
    expect(row).toMatchObject({ authorName: "Authoritative alpha", uploaderChannelId: "author-alpha", createdAt: new Date(publication), folderId: "yt:pl:mixed", summary: "Human correction" });
    expect(JSON.parse(row.rawJson ?? "{}")).toMatchObject({ playlistId: "mixed", xbookSourceEvidence: { captured: "Prior evidence" }, xbookVideoMetadata: { version: 1, kind: "found" } });
    expect(await backfillYouTubeMetadata({ database, provider })).toMatchObject({ updated: 0, requests: 0 });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("repairs malformed legacy item metadata from authoritative evidence without losing original raw", async () => {
    await seed("alpha", false);
    const malformed = JSON.stringify({ item: 42, existingCapture: { text: "Original evidence" } });
    await database.bookmark.update({ where: { id: "alpha" }, data: { rawJson: malformed } });
    const provider = vi.fn(async (ids: string[]) => ids.map(video));
    expect(await backfillYouTubeMetadata({ database, provider })).toMatchObject({ updated: 1, requests: 1 });
    const repaired = await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } });
    expect(repaired.authorName).toBe("Authoritative alpha");
    expect(JSON.parse(repaired.rawJson ?? "{}")).toMatchObject({ item: 42, existingCapture: { text: "Original evidence" } });
    expect(await backfillYouTubeMetadata({ database, provider })).toMatchObject({ updated: 0, requests: 0 });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("reuses authoritative metadata across database pages for duplicate playlist entries", async () => {
    for (let index = 0; index < 55; index++) {
      const id = `duplicate-${String(index).padStart(3, "0")}`;
      await database.bookmark.create({ data: { id, source: "yt", tweetUrl: "https://www.youtube.com/watch?v=shared", rawJson: raw("shared", "Useful video", false) } });
    }
    const provider = vi.fn(async (ids: string[]) => ids.map(video));
    expect(await backfillYouTubeMetadata({ database, provider, options: { maxItems: 55, maxRequests: 1 } })).toMatchObject({ status: "completed", updated: 55, requests: 1 });
    expect(provider).toHaveBeenCalledExactlyOnceWith(["shared"]);
    expect(await database.bookmark.count({ where: { authorName: "Authoritative shared" } })).toBe(55);
  });
  it("stops on quota at the last committed cursor and resumes without changing user data", async () => {
    await seed("alpha"); await seed("beta", false);
    const quota = vi.fn(async () => { throw new YouTubeMetadataProviderError("quota", "Quota reached"); });
    const stopped = await backfillYouTubeMetadata({ database, provider: quota });
    expect(stopped).toMatchObject({ status: "paused", reason: "quota", afterId: "alpha", scanned: 1, requests: 1 });
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "beta" } })).authorName).toBe("Playlist owner");
    expect(await backfillYouTubeMetadata({ database, provider: async (ids) => ids.map(video), options: { afterId: stopped.afterId } })).toMatchObject({ status: "completed", scanned: 1, updated: 1 });
  });
  it("uses item/request limits before calling providers and supplies resumable cursors", async () => {
    await seed("alpha"); await seed("beta", false);
    const provider = vi.fn(async (ids: string[]) => ids.map(video));
    const limited = await backfillYouTubeMetadata({ database, provider, options: { maxItems: 1 } });
    expect(limited).toMatchObject({ status: "paused", reason: "item_limit", afterId: "alpha", requests: 0 });
    expect(await backfillYouTubeMetadata({ database, provider, options: { afterId: limited.afterId, maxRequests: 0 } })).toMatchObject({ status: "paused", reason: "request_limit", afterId: "alpha", scanned: 0 });
    expect(provider).not.toHaveBeenCalled();
    await expect(backfillYouTubeMetadata({ database, provider, options: { maxItems: NaN } })).rejects.toThrow();
  });
  it("labels missing videos honestly and preserves old captured evidence/manual digests", async () => {
    const before = await seed("deleted", false, "Deleted video"); await seed("missing", false);
    await backfillYouTubeMetadata({ database, provider: async () => [] });
    const deleted = await database.bookmark.findUniqueOrThrow({ where: { id: "deleted" } });
    expect(deleted).toMatchObject({ availability: "deleted", captureJson: before.captureJson, summary: before.summary, readAt: before.readAt, folderId: before.folderId });
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "missing" } })).availability).toBe("unavailable");
    expect(await backfillYouTubeMetadata({ database, provider: async () => { throw Error("must not request cached missing"); } })).toMatchObject({ updated: 0, requests: 0 });
  });
  it("does not overwrite raw capture refreshed while the authoritative request is in flight", async () => {
    await seed("alpha", false);
    const result = await backfillYouTubeMetadata({ database, provider: async (ids) => {
      await database.bookmark.update({ where: { id: "alpha" }, data: { rawJson: raw("alpha", "New capture", true), summary: "New human correction" } });
      return ids.map(video);
    } });
    expect(result).toMatchObject({ status: "paused", reason: "changed", afterId: null, updated: 0 });
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } })).summary).toBe("New human correction");
    expect(await backfillYouTubeMetadata({ database })).toMatchObject({ updated: 1, requests: 0 });
  });
  it("supports bounded explicit authoritative refresh while preserving current unavailable labels", async () => {
    await seed("alpha");
    await backfillYouTubeMetadata({ database, provider: async (ids) => ids.map(video), options: { refresh: "all" } });
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } })).authorName).toBe("Authoritative alpha");
    const placeholder = withVideoMetadata(raw("private", "Private video"), video("private"));
    expect(metadataFromStoredRaw(placeholder)?.availability).toBe("private");
    const legacy = JSON.stringify({ item: { snippet: { videoOwnerChannelTitle: 123 } }, custom: { untouched: true } });
    expect(JSON.parse(withVideoMetadata(legacy, video("alpha")))).toMatchObject({ item: { snippet: { videoOwnerChannelTitle: 123 } }, custom: { untouched: true } });
    await backfillYouTubeMetadata({ database, provider: async () => [], options: { refresh: "all" } });
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } })).availability).toBe("unavailable");
  });
  it("cannot commit a provider response after stop, including a provider that ignores abort", async () => {
    await seed("alpha", false);
    const controller = new AbortController();
    const result = await backfillYouTubeMetadata({ database, signal: controller.signal, provider: async (ids) => {
      controller.abort(); return ids.map(video);
    } });
    expect(result).toMatchObject({ status: "paused", reason: "stopped", updated: 0, afterId: null });
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } })).authorName).toBe("Playlist owner");
  });
  it("never performs a stopped request or treats malformed provider output as missing video", async () => {
    await seed("alpha", false); const controller = new AbortController(); controller.abort();
    const provider = vi.fn(async (ids: string[]) => ids.map(video));
    expect(await backfillYouTubeMetadata({ database, provider, signal: controller.signal })).toMatchObject({ status: "paused", reason: "stopped", requests: 0 });
    expect(provider).not.toHaveBeenCalled();
    const broken = createYouTubeMetadataProvider({ accessToken: "fixture-only", fetch: async () => Response.json({ items: [{ id: "alpha" }] }) });
    expect(await backfillYouTubeMetadata({ database, provider: broken })).toMatchObject({ status: "paused", reason: "provider", updated: 0 });
  });
});

describe("digest evidence eligibility", () => {
  it.each(["available", "unknown", "deleted", "private", "unavailable"])("blocks unsupported title-only %s videos", (availability) => {
    expect(allowsConfidentDigest({ availability })).toMatchObject({ ok: false });
    expect(allowsConfidentDigest({ availability, description: "Title only" })).toMatchObject({ ok: false });
  });
  it("accepts limited prior transcript/adequate description without changing availability", () => {
    expect(allowsConfidentDigest({ availability: "deleted", transcript: "Useful prior captured transcript" })).toMatchObject({ ok: true, limited: true });
    expect(allowsConfidentDigest({ availability: "available", description: "This source explains the actual method and evidence from the experiment including measurements, control groups, known limitations, and the conclusions supported by the observed results." })).toMatchObject({ ok: true, limited: true });
  });
});

it("uses a real HTTP metadata fixture, one bounded IDs request, and recognizes provider quota", async () => {
  const requests: string[] = [];
  let quota = false;
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? "");
    expect(request.headers.authorization).toBe("Bearer fixture-only");
    response.writeHead(quota ? 403 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(quota ? { error: { errors: [{ reason: "quotaExceeded" }] } } : { items: [video("alpha")] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Fixture did not bind TCP");
  const provider = createYouTubeMetadataProvider({ accessToken: "fixture-only", fetch: (url, init) => {
    const original = new URL(String(url));
    return fetch(`http://127.0.0.1:${address.port}${original.pathname}${original.search}`, init);
  } });
  try {
    await seed("alpha", false);
    expect(await backfillYouTubeMetadata({ database, provider })).toMatchObject({ updated: 1, requests: 1 });
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0], "http://fixture").searchParams.get("id")).toBe("alpha");
    expect(new URL(requests[0], "http://fixture").searchParams.get("part")).toBe("snippet");
    quota = true;
    expect(await backfillYouTubeMetadata({ database, provider, options: { refresh: "all" } })).toMatchObject({ status: "paused", reason: "quota" });
    expect(requests).toHaveLength(2);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});


describe("bounded metadata repair endpoint", () => {
  function request(body: unknown) { return new Request("http://fixture/api/youtube/metadata/repair", { method: "POST", body: JSON.stringify(body) }); }
  it("repairs raw history without credentials and validates boundaries before access", async () => {
    await seed("alpha");
    const getAccessToken = vi.fn(async () => "fixture-only");
    const handler = createYouTubeMetadataRepairHandler({ database, getAccessToken });
    const response = await handler(request({ maxItems: 1, maxRequests: 0 }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, updated: 1, requests: 0 });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect((await handler(request({ maxRequests: 2 }))).status).toBe(400);
    expect((await handler(request({ maxItems: 1.5 }))).status).toBe(400);
  });
  it.each(["queued", "running", "paused"])("rejects an active %s operation before provider access", async (status) => {
    await seed("alpha", false); await database.operationRun.create({ data: { type: "fixture", status } });
    const getAccessToken = vi.fn(async () => "fixture-only");
    const handler = createYouTubeMetadataRepairHandler({ database, getAccessToken });
    expect((await handler(request({ maxRequests: 1 }))).status).toBe(409);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } })).authorName).toBe("Playlist owner");
  });
  it("checks ownership again under a write transaction after the provider returns", async () => {
    await seed("alpha", false);
    const handler = createYouTubeMetadataRepairHandler({ database, getAccessToken: async () => "fixture-only", createProvider: () => async (ids) => {
      await database.operationRun.create({ data: { type: "competing", status: "running" } });
      return ids.map(video);
    } });
    expect((await handler(request({ maxRequests: 1 }))).status).toBe(409);
    expect((await database.bookmark.findUniqueOrThrow({ where: { id: "alpha" } })).authorName).toBe("Playlist owner");
  });
  it("rejects unfinished legacy imports and allows safe idempotent restart after completion", async () => {
    await seed("alpha");
    const run = await database.importRun.create({ data: {} });
    const handler = createYouTubeMetadataRepairHandler({ database, getAccessToken: async () => "fixture-only" });
    expect((await handler(request({}))).status).toBe(409);
    await database.importRun.update({ where: { id: run.id }, data: { finishedAt: new Date() } });
    expect(await (await handler(request({}))).json()).toMatchObject({ updated: 1 });
    expect(await (await handler(request({}))).json()).toMatchObject({ updated: 0 });
  });
});
