import { describe, expect, it } from "vitest";
import { textMatches } from "@/lib/bookmark-text";
import { decodeEmbedding } from "@/lib/embedding-vectors";
import { classifyRunStatus } from "@/lib/run-status";
import { formatRunOutcome } from "@/app/lib/formatters";
import { metadataFromPlaylistItem, allowsConfidentDigest } from "@/lib/youtube-metadata";
import { boundSourceText, isExternalContentUrl } from "@/lib/article-extract";
import { getBackupDownloadFilename } from "@/lib/backup-download-name";

describe("repair behavior", () => {
  it("keeps substring matches and distinguishes whole words", () => {
    expect(textMatches("economic policy", "nomic", "substring")).toBe(true);
    expect(textMatches("economic policy", "nomic", "word")).toBe(false);
    expect(textMatches("nomic embed", "nomic", "phrase")).toBe(true);
  });

  it("rejects malformed vectors", () => {
    expect(decodeEmbedding(new Uint8Array([1, 2, 3]))).toBeNull();
    const zero = new Uint8Array(new Float32Array([0, 0]).buffer);
    expect(decodeEmbedding(zero)).toBeNull();
    const nan = new Uint8Array(new Float32Array([Number.NaN, 1]).buffer);
    expect(decodeEmbedding(nan)).toBeNull();
    const ok = new Uint8Array(new Float32Array([1, 0]).buffer);
    expect(decodeEmbedding(ok, 3)).toBeNull();
    expect(decodeEmbedding(ok, 2)).toEqual([1, 0]);
  });

  it("does not call a total failure completed", () => {
    expect(classifyRunStatus({ updated: 0, failed: 100, remaining: 0 })).toBe("failed");
    expect(classifyRunStatus({ updated: 2, failed: 1, remaining: 4 })).toBe("paused");
    expect(formatRunOutcome({ status: "completed", updated: 0, failed: 100, processed: 100, total: 100 })).toBe("Failed · 100 failed");
    expect(formatRunOutcome({ status: "completed", updated: 18, failed: 2, processed: 20, total: 50, notes: "Completed." })).toBe("18 updated · 2 failed");
  });

  it("separates video owner, publication, and playlist addition", () => {
    const metadata = metadataFromPlaylistItem({
      snippet: {
        title: "A talk",
        publishedAt: "2024-01-02T00:00:00Z",
        channelTitle: "Playlist owner",
        videoOwnerChannelTitle: "Real uploader",
        videoOwnerChannelId: "UC123",
      },
      contentDetails: { videoPublishedAt: "2020-05-01T00:00:00Z" },
    });
    expect(metadata.authorName).toBe("Real uploader");
    expect(metadata.uploaderChannelId).toBe("UC123");
    expect(metadata.createdAt?.toISOString()).toBe("2020-05-01T00:00:00.000Z");
    expect(metadata.playlistAddedAt?.toISOString()).toBe("2024-01-02T00:00:00.000Z");
    expect(allowsConfidentDigest({ availability: "deleted", transcript: "" }).ok).toBe(false);
  });

  it("keeps the tail of a long source and blocks private destinations", () => {
    const bounded = boundSourceText(`${"a".repeat(200)}TAILFACT`, 120);
    expect(bounded.status).toBe("partial");
    expect(bounded.text.endsWith("TAILFACT")).toBe(true);
    expect(isExternalContentUrl("http://127.0.0.1/secret")).toBe(false);
    expect(isExternalContentUrl("https://example.com/story")).toBe(true);
    expect(getBackupDownloadFilename("before_enrichment")).toBe("before_enrichment.db");
    expect(getBackupDownloadFilename("../secrets")).toBe("___secrets.db");
  });
});
