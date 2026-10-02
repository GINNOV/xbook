// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { extractArticle, fetchArticleCapture } from "@/lib/article-extract";
import { fetchPublicWeb, isPublicAddress, publicWebUrl } from "@/lib/public-web";
import { reduceSourceSections } from "@/lib/section-summary";
import { readCapturedSource, textCapture } from "@/lib/source-evidence";

describe("bounded source processing", () => {
  it("extracts the article body without scripts or navigation and retains its tail", () => {
    const extracted = extractArticle(`<html lang="it"><body><nav>${"Menu navigation ".repeat(80)}</nav><article><h1>Measured reactor results</h1><p>${"The scientists measured the reactor under controlled conditions. ".repeat(80)}</p><p>The final cobalt calibration is 73 kelvin.</p></article><script>private script secret</script></body></html>`, "https://example.com/article");
    expect(extracted.text).toContain("73 kelvin"); expect(extracted.text).not.toContain("private script");
    expect(extracted.text).not.toContain("Menu navigation"); expect(extracted.language).toBe("it");
  });
  it("rejects private IP encodings, mixed IPv6, credentials and protocols", () => {
    for (const address of ["127.0.0.1", "100.64.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"]) expect(isPublicAddress(address)).toBe(false);
    for (const value of ["http://2130706433/", "http://0x7f000001/", "http://[::ffff:127.0.0.1]/", "https://user:pass@example.com/", "file:///etc/passwd"]) expect(() => publicWebUrl(value)).toThrow();
    expect(isPublicAddress("8.8.8.8")).toBe(true); expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("validates redirect destinations before the next request", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 302, headers: { location: "http://127.0.0.1/" }, text: "" });
    await expect(fetchPublicWeb("https://example.com", { transport })).rejects.toThrow(/public/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("has a bounded redirect count and cancels a stalled capture", async () => {
    const redirect = vi.fn().mockResolvedValue({ status: 302, headers: { location: "/next" }, text: "" });
    await expect(fetchPublicWeb("https://example.com", { transport: redirect })).rejects.toThrow(/redirect budget/);
    expect(redirect).toHaveBeenCalledTimes(4);
    const controller = new AbortController();
    const pending = fetchArticleCapture("https://example.com", { signal: controller.signal, transport: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) });
    controller.abort(new Error("Stop capture")); await expect(pending).rejects.toThrow("Stop capture");
  });
  it("processes every bounded section including the tail, then reduces notes", async () => {
    const input = Array.from({ length: 20 }, (_, i) => `Section ${i}: ${"measured context ".repeat(60)}`).join("\n") + " Final cobalt calibration is 73 kelvin.";
    const supplied: string[] = [];
    const notes = await reduceSourceSections({ text: input, budget: 1000, summarize: async (section) => { supplied.push(section); return section.includes("73 kelvin") ? "Final cobalt calibration is 73 kelvin." : "Measured context."; } });
    expect(supplied.join("")).toContain("73 kelvin"); expect(notes).toContain("73 kelvin"); expect(notes.length).toBeLessThanOrEqual(1000);
    expect(supplied.every((section) => section.length <= 1000)).toBe(true);
  });
  it("rejects tiny contexts or oversized notes without silently truncating", async () => {
    const summarize = vi.fn().mockResolvedValue("x".repeat(600));
    await expect(reduceSourceSections({ text: "source", budget: 10, summarize })).rejects.toThrow(/context window/);
    expect(summarize).not.toHaveBeenCalled();
    await expect(reduceSourceSections({ text: "x".repeat(2000), budget: 1000, summarize })).rejects.toThrow(/response budget/);
  });
  it("stores capture independently and validates the versioned boundary", () => {
    const capture = textCapture("Useful original source", "Description only.");
    expect(readCapturedSource(JSON.stringify({ version: 2, method: "description", language: "en", sourceUrls: ["https://example.com"], capture }))?.capture.status).toBe("partial");
    expect(readCapturedSource('{"version":99}')).toBeNull();
  });
});
