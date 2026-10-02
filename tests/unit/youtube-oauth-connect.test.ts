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
  it("cancels observation immediately without clearing credentials or starting another poll", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ settings: { ytAccessToken: "old", ytTokenExpiresAt: "2020-01-01" } }) });
    const pending = waitForYouTubeToken({ previousExpiresAt: "2020-01-01", intervalMs: 10000, signal: controller.signal, fetchImpl });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/settings", { cache: "no-store", signal: controller.signal });
  });

});
