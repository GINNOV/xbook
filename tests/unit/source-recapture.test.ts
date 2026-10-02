// @vitest-environment node
import "../fixtures/public-web";
import { afterEach, describe, it, expect, vi } from "vitest";
import { captureBookmarkSourceEvidence, readCapturedSource, textCapture } from "@/lib/source-evidence";

const priorText = "Earlier captured measurements prove the cobalt reactor calibration was 73 kelvin under the recorded controlled conditions.";
function prior(method: "transcript" | "article") {
  const capture = { ...textCapture(priorText), capturedAt: "2025-01-01T00:00:00.000Z" };
  return JSON.stringify({ version: 2, method, language: "en", sourceUrls: ["https://example.com/article"], capture });
}
afterEach(() => vi.unstubAllGlobals());
describe("failed source recapture preservation", () => {
  it("retains a prior transcript with its timestamp and disclosed recapture failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
    const result = await captureBookmarkSourceEvidence({ source: "yt", availability: "available", tweetUrl: "https://youtube.com/watch?v=fixture", rawJson: "{}", captureJson: prior("transcript") });
    expect(result.eligible).toBe(true); expect(result.capture.status).toBe("partial");
    expect(result.capture.capturedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(result.capture.reason).toContain("Fresh capture failed");
    expect(result.sourceText).toContain(priorText);
    expect(readCapturedSource(result.captureJson)?.capture.sections[0].text).toBe(priorText);
  });
  it("retains a prior article when the linked source is temporarily unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
    const result = await captureBookmarkSourceEvidence({ source: "x", tweetUrl: "https://x.com/fixture", text: "Original bookmark pointing to measurements",
      externalUrls: JSON.stringify(["https://example.com/article"]), rawJson: "{}", captureJson: prior("article") });
    expect(result.method).toBe("article");
    expect(result.capture.status).toBe("partial");
    expect(result.capture.reason).toContain("Retained earlier");
    expect(result.sourceText).toContain(priorText);
  });
  it("retains unavailable video capture without fabricating a new fetch or timestamp", async () => {
    const fetchFixture = vi.fn(async () => new Response("Must not fetch", { status: 503 })); vi.stubGlobal("fetch", fetchFixture);
    const result = await captureBookmarkSourceEvidence({ source: "yt", availability: "deleted", tweetUrl: "https://youtube.com/watch?v=fixture", rawJson: "{}", captureJson: prior("transcript") });
    expect(result.eligible).toBe(true); expect(result.sourceText).toContain(priorText);
    expect(result.capture.capturedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(fetchFixture).not.toHaveBeenCalled();
  });
});
