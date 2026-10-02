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
    expect(itemRequest[1]).toEqual({ headers: { Authorization: "Bearer valid-yt-token" } });
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
