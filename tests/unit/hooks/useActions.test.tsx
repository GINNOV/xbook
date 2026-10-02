import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useActions } from "@/app/hooks/useActions";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function mockProvider(response: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => { if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return url.includes("?take=") ? json({ runs: [] }) : response(); }));
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe("useActions", () => {
  it("imports new bookmarks and reports the imported count", async () => {
    mockProvider(() => json({ ok: true, imported: 5 }));
    const { result, unmount } = renderHook(() => useActions("x", 50));
    await act(async () => { await result.current.runImport(); });
    expect(fetch).toHaveBeenCalledWith("/api/import?source=x", expect.objectContaining({ method: "POST" }));
    expect(result.current.message).toContain("Imported 5");
    unmount();
  });

  it("submits enrichment once and reports authoritative cumulative totals", async () => {
    const run = { id: "actions-run", source: "yt", type: "enrichment_batch", status: "completed", total: 5, processed: 5, updated: 4, failed: 1, skipped: 0 };
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => { if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return url.includes("?take=") ? json({ runs: [] }) : url.startsWith("/api/enrich?") ? json({ runId: run.id, remaining: 5 }, 202) : json({ run }); }));
    const { result, unmount } = renderHook(() => useActions("yt", 200));
    let completion: ReturnType<typeof result.current.runEnrich>;
    await act(async () => { completion = result.current.runEnrich(false); await Promise.resolve(); });
    await waitFor(() => expect(result.current.loading.enrichYt).toBe(false));
    expect(await completion!).toMatchObject({ totalUpdated: 4, totalProcessed: 5, errorsCount: 1 });
    expect(result.current.message).toContain("4/5 updated");
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("source=yt&limit=200&full=false"), expect.objectContaining({ headers: { "Idempotency-Key": expect.any(String) } }));
    unmount();
  });

  it("surfaces an empty import response with an actionable message", async () => {
    mockProvider(() => new Response("", { status: 200 }));
    const { result, unmount } = renderHook(() => useActions("x", 50));
    await act(async () => { await result.current.runImport(); });
    expect(result.current.message).toMatch(/Empty response|timed out/i);
    expect(result.current.message).not.toMatch(/Unexpected end of JSON input/);
    unmount();
  });

  it("requests the full frozen scope for Enrich all", async () => {
    mockProvider(() => json({ ok: true, processed: 0, remaining: 0 }));
    const { result, unmount } = renderHook(() => useActions("x", 50));
    await act(async () => { await result.current.runEnrich(true, true); });
    expect(fetch).toHaveBeenCalledWith("/api/enrich?source=x&limit=50&full=true&reprocess=true", expect.objectContaining({ method: "POST" }));
    expect(result.current.message).toContain("No bookmarks need enrichment");
    unmount();
  });
});
