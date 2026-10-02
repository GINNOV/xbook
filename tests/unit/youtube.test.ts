import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchYouTubeBookmarks } from "@/lib/youtube";
import { getSettings } from "@/lib/settings";

vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

global.fetch = vi.fn();

describe("youtube lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue({
      ytAccessToken: "valid-yt-token",
    } as any);
  });

  it("uses each video's uploader and publication date in a mixed playlist", async () => {
    const playlist = {
      id: "pl-1",
      snippet: { title: "My Playlist" },
      contentDetails: { itemCount: 3 },
    };
    const entries = [
      {
        id: "playlist-item-1",
        snippet: {
          resourceId: { videoId: "vid-1" },
          title: "YT Video",
          description: "A cool video",
          channelTitle: "Playlist Curator",
          videoOwnerChannelTitle: "First Uploader",
          publishedAt: "2026-04-24T00:00:00Z",
        },
        contentDetails: { videoPublishedAt: "2020-05-10T12:30:00Z" },
      },
      {
        id: "playlist-item-2",
        snippet: {
          resourceId: { videoId: "vid-2" },
          title: "Another Video",
          channelTitle: "Playlist Curator",
          videoOwnerChannelTitle: "Second Uploader",
          publishedAt: "2026-04-25T00:00:00Z",
        },
        contentDetails: { videoPublishedAt: "2023-07-01T09:00:00Z" },
      },
      {
        id: "playlist-item-3",
        snippet: {
          resourceId: { videoId: "vid-3" },
          title: "Missing video metadata",
          channelTitle: "Playlist Curator",
          publishedAt: "2026-04-26T00:00:00Z",
        },
      },
    ];
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ items: [playlist] }))
      .mockResolvedValueOnce(Response.json({ items: entries }));

    const items = await fetchYouTubeBookmarks();

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: "yt:pl-1:vid-1",
      tweetUrl: "https://www.youtube.com/watch?v=vid-1",
      title: "YT Video",
      text: "YT Video\n\nA cool video",
      authorName: "First Uploader",
      authorUsername: "First Uploader",
      createdAt: new Date("2020-05-10T12:30:00Z"),
      folderId: "yt:pl:pl-1",
      folderName: "My Playlist",
      externalUrls: ["https://www.youtube.com/watch?v=vid-1"],
    });
    expect(items[1]).toMatchObject({
      authorName: "Second Uploader",
      authorUsername: "Second Uploader",
      createdAt: new Date("2023-07-01T09:00:00Z"),
    });
    expect(items[2].authorName).toBeUndefined();
    expect(items[2].authorUsername).toBeUndefined();
    expect(items[2].createdAt).toBeUndefined();
    for (const [index, item] of items.entries()) {
      expect(item.id).toBe(`yt:pl-1:vid-${index + 1}`);
      expect(item.folderId).toBe("yt:pl:pl-1");
      expect(JSON.parse(item.rawJson)).toEqual({
        playlistId: "pl-1",
        playlistTitle: "My Playlist",
        item: entries[index],
      });
    }
    const itemRequest = vi.mocked(fetch).mock.calls[1];
    expect(itemRequest[0]).toBeInstanceOf(URL);
    expect(String(itemRequest[0])).toContain("part=snippet%2CcontentDetails");
    expect(itemRequest[1]).toMatchObject({ headers: { Authorization: "Bearer valid-yt-token" }, signal: expect.any(AbortSignal) });
  });

  it.each([
    undefined,
    null,
    "",
    "not-a-date",
    "2026-99-99T00:00:00Z",
    1776988800000,
  ])("leaves publication unknown for invalid or missing videoPublishedAt %s", async (videoPublishedAt) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ items: [{ id: "pl-1", snippet: { title: "My Playlist" } }] }))
      .mockResolvedValueOnce(Response.json({
        items: [{
          snippet: {
            resourceId: { videoId: "vid-1" },
            channelTitle: "Playlist Curator",
            videoOwnerChannelTitle: "Video Uploader",
            publishedAt: "2026-04-24T00:00:00Z",
          },
          contentDetails: { videoPublishedAt },
        }],
      }));

    const items = await fetchYouTubeBookmarks();

    expect(items).toHaveLength(1);
    expect(items[0].authorName).toBe("Video Uploader");
    expect(items[0].createdAt).toBeUndefined();
  });
});

describe("durable YouTube provider identity", () => {
  const saved = { id: "default", ytClientId: "client", ytAccessToken: "valid-token", ytRefreshToken: "original-refresh" };
  beforeEach(() => { vi.mocked(fetch).mockReset(); vi.mocked(getSettings).mockResolvedValue(saved); });
  const video = (channelId?: string) => ({ snippet: { ...(channelId ? { channelId } : {}), title: "Video", resourceId: { videoId: "video" }, videoOwnerChannelTitle: "Actual uploader" } });
  it("accepts same-client refresh-token rotation and preserves distinct playlist-owner and uploader identities", async () => {
    const { createHash } = await import("node:crypto"); const { fetchYouTubeImportFolders, fetchYouTubeImportPage } = await import("@/lib/youtube");
    const accountFingerprint = `client:${createHash("sha256").update(JSON.stringify(["client"])).digest("hex")}`;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [{ id: "PLone", snippet: { channelId: "owner-A", title: "Playlist" } }] }));
    const discovery = await fetchYouTubeImportFolders(null, new AbortController().signal, { accountFingerprint }); expect(discovery.ownerId).toBe("owner-A");
    vi.mocked(getSettings).mockResolvedValue({ ...saved, ytRefreshToken: "legitimate-rotation", ytAccessToken: "rotated-access" }); vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [video("owner-A")] }));
    const page = await fetchYouTubeImportPage({ folderId: "yt:pl:PLone", folderName: "Playlist", cursor: null, signal: new AbortController().signal, provider: { accountFingerprint, ownerId: discovery.ownerId } });
    expect(page.ownerId).toBe("owner-A"); expect(page.items[0].authorName).toBe("Actual uploader"); expect(page.items[0].authorName).not.toBe(page.ownerId);
  });
  it("rejects a different or malformed owner in both discovery and playlist pages", async () => {
    const { fetchYouTubeImportFolders, fetchYouTubeImportPage } = await import("@/lib/youtube"); const signal = new AbortController().signal;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [{ id: "PLother", snippet: { channelId: "owner-B", title: "Other" } }] }));
    await expect(fetchYouTubeImportFolders("page2", signal, { ownerId: "owner-A" })).rejects.toThrow("owner does not match");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [video("owner-B")] })); await expect(fetchYouTubeImportPage({ folderId: "yt:pl:PLone", folderName: "Playlist", cursor: "page2", signal, provider: { ownerId: "owner-A" } })).rejects.toThrow("owner does not match");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [video()] })); await expect(fetchYouTubeImportPage({ folderId: "yt:pl:PLone", folderName: "Playlist", cursor: "page2", signal, provider: { ownerId: "owner-A" } })).rejects.toThrow("owner is missing");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [{ id: "PLother", snippet: { title: "Malformed owner" } }] })); await expect(fetchYouTubeImportFolders("page2", signal, { ownerId: "owner-A" })).rejects.toThrow("owner is missing");
  });
});
