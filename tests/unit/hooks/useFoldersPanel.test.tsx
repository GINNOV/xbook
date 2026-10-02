import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { importOperationFixture } from "../../fixtures/import-operation";
import { useFoldersPanel } from "@/app/hooks/useFoldersPanel";

function mockJsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? (init.ok === false ? 500 : 200) });
}

describe("useFoldersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    global.fetch = vi.fn(async (url: Parameters<typeof fetch>[0]) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) : mockJsonResponse({}));
  });

  it("should sync folders", async () => {
    vi.mocked(fetch).mockImplementation(async (url: Parameters<typeof fetch>[0]) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) : mockJsonResponse({ ok: true, total: 5 }));

    const { result } = renderHook(() => useFoldersPanel([]));

    await act(async () => {
      await result.current.syncFolders();
    });

    expect(fetch).toHaveBeenCalledWith("/api/folders/sync", { method: "POST" });
    expect(result.current.msg?.text).toContain("Synced 5 folder names");
  });

  it("imports a folder once and reports entry counts independently of pages", async () => {
    const run = importOperationFixture({ imported: 10, refreshed: 2 });
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) : String(url).startsWith("/api/folders/import?") ? mockJsonResponse({ runId: run.id }, { status: 202 }) : mockJsonResponse({ run }));
    const { result, unmount } = renderHook(() => useFoldersPanel([]));
    await act(async () => { void result.current.importFolder("f1"); await Promise.resolve(); });
    await waitFor(() => expect(result.current.loading.importing).toBeNull());
    expect(fetch).toHaveBeenCalledWith("/api/folders/import?source=x&folderId=f1", expect.objectContaining({ method: "POST", headers: { "Idempotency-Key": expect.any(String) } }));
    expect(result.current.msg?.text).toContain("10 new · 2 refreshed");
    expect(result.current.msg?.text).toContain("3 pages fetched");
    unmount();
  });

  it("should process a folder", async () => {
    vi.mocked(fetch).mockImplementation(async (url: Parameters<typeof fetch>[0]) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) :
      mockJsonResponse({ ok: true, processed: 0, updated: 0, errors: [], remaining: 0, finished: true })
    );

    const { result } = renderHook(() => useFoldersPanel([]));

    await act(async () => {
      await result.current.processFolder("f1");
    });

    expect(fetch).toHaveBeenCalledWith("/api/enrich?source=x&folderId=f1&full=true", expect.objectContaining({ method: "POST", headers: { "Idempotency-Key": expect.any(String) } }));
  });

  it("should handle sync failure", async () => {
    vi.mocked(fetch).mockImplementation(async (url: Parameters<typeof fetch>[0]) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) :
      mockJsonResponse({ error: "Sync failed" }, { ok: false, status: 500 })
    );

    const { result } = renderHook(() => useFoldersPanel([]));

    await act(async () => {
      await result.current.syncFolders();
    });

    expect(result.current.msg?.isError).toBe(true);
    expect(result.current.msg?.text).toBe("Sync failed");
  });

  it("should handle import failure", async () => {
    vi.mocked(fetch).mockImplementation(async (url: Parameters<typeof fetch>[0]) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) :
      mockJsonResponse({ error: "Import failed" }, { ok: false, status: 500 })
    );

    const { result } = renderHook(() => useFoldersPanel([]));

    await act(async () => {
      await result.current.importFolder("f1");
    });

    expect(result.current.msg?.isError).toBe(true);
    expect(result.current.msg?.text).toBe("Import failed");
  });

  it("submits Import all once for server-owned folder continuation", async () => {
    const run = importOperationFixture();
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) : String(url).startsWith("/api/folders/import?") ? mockJsonResponse({ runId: run.id }, { status: 202 }) : mockJsonResponse({ run }));
    const { result, unmount } = renderHook(() => useFoldersPanel([{ id: "f1", name: "One" }, { id: "f2", name: "Two" }]));
    await act(async () => { void result.current.importAllFolders(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.loading.all).toBe(false));
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/folders/import?source=x&all=true", expect.objectContaining({ method: "POST" }));
    expect(result.current.msg?.text).toContain("2/2 folders finished");
    unmount();
  });

  it("uses the same scoped summarize/index contract for YouTube playlists", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) : mockJsonResponse({ ok: true }));
    const { result, unmount } = renderHook(() => useFoldersPanel([], false, false, "yt"));
    await act(async () => { await result.current.processFolder("yt:pl:PL one"); await result.current.indexFolder("yt:pl:PL one"); });
    expect(fetch).toHaveBeenCalledWith("/api/enrich?source=yt&folderId=yt%3Apl%3APL%20one&full=true", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenCalledWith("/api/bookmarks/embeddings/sync?source=yt&folderId=yt%3Apl%3APL%20one&full=true", expect.objectContaining({ method: "POST" }));
    unmount();
  });
});
