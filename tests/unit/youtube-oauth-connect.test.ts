import { describe, expect, it, vi } from "vitest";
import { waitForYouTubeToken } from "@/app/lib/youtube-oauth-connect";

describe("waitForYouTubeToken", () => {
  it("returns settings once a newer access token appears", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ settings: { ytAccessToken: "old", ytTokenExpiresAt: "2026-06-23T00:00:00.000Z" } }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          settings: {
            ytAccessToken: "new-token",
            ytRefreshToken: "refresh",
            ytTokenExpiresAt: "2026-08-17T14:00:00.000Z",
          },
        }),
      });

    const result = await waitForYouTubeToken({
      previousExpiresAt: "2026-06-23T00:00:00.000Z",
      timeoutMs: 1_000,
      intervalMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result?.ytAccessToken).toBe("new-token");
    expect(fetchImpl).toHaveBeenCalledWith("/api/settings", { cache: "no-store" });
  });

  it("returns null when the token never updates", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ settings: { ytAccessToken: "old", ytTokenExpiresAt: "2026-06-23T00:00:00.000Z" } }),
    });

    const result = await waitForYouTubeToken({
      previousExpiresAt: "2026-06-23T00:00:00.000Z",
      timeoutMs: 20,
      intervalMs: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBeNull();
  });
});
