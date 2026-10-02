// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYouTubeTranscriptCaptureFromUrl, TRANSCRIPT_NETWORK_BYTE_LIMIT } from "@/lib/youtubeTranscript";

afterEach(() => vi.unstubAllGlobals());

describe("transcript network cancellation and bounds", () => {
  it("cancels a body read after headers and starts no caption request", async () => {
    const controller = new AbortController();
    let canceled = false;
    let fetched: (() => void) | undefined;
    const headers = new Promise<void>((resolve) => { fetched = resolve; });
    const fetchMock = vi.fn(async () => {
      fetched?.();
      return new Response(new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchYouTubeTranscriptCaptureFromUrl("https://youtube.com/watch?v=fixture", controller.signal);
    await headers;
    // Let the capture attach its body cancellation listener after fetch resolves.
    await Promise.resolve(); await Promise.resolve();
    controller.abort(new Error("Stopped capture"));
    await expect(result).rejects.toThrow("Stopped capture");
    expect(canceled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels an oversized streamed response before consuming its remainder", async () => {
    let canceled = false;
    let pulls = 0;
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(stream) { pulls++; stream.enqueue(new Uint8Array(TRANSCRIPT_NETWORK_BYTE_LIMIT + 1)); },
      cancel() { canceled = true; },
    })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchYouTubeTranscriptCaptureFromUrl("https://youtube.com/watch?v=fixture")).toMatchObject({ status: "missing", reason: expect.stringContaining("byte limit") });
    expect(canceled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start a request for an already stopped operation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController(); controller.abort(new Error("Stopped"));
    await expect(fetchYouTubeTranscriptCaptureFromUrl("https://youtube.com/watch?v=fixture", controller.signal)).rejects.toThrow("Stopped");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
