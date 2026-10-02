import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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
    expect(result.current.msg?.text).toContain("Synced 5 folders");
  });

  it("should import a folder", async () => {
    vi.mocked(fetch).mockImplementation(async (url: Parameters<typeof fetch>[0]) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) : 
      mockJsonResponse({ ok: true, imported: 10, refreshed: 2, pagesFetched: 1 })
    );

    const { result } = renderHook(() => useFoldersPanel([]));

    await act(async () => {
      await result.current.importFolder("f1");
    });

    expect(fetch).toHaveBeenCalledWith("/api/folders/import?folderId=f1", { method: "POST" });
    expect(result.current.msg?.text).toContain("Imported 10");
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

  it("should import all folders", async () => {
    vi.mocked(fetch).mockImplementation(async (url: Parameters<typeof fetch>[0]) => String(url).includes("?take=") ? mockJsonResponse({ runs: [] }) : 
      mockJsonResponse({ ok: true, imported: 5 })
    );

    const { result } = renderHook(() =>
      useFoldersPanel([
        { id: "f1", name: "One" },
        { id: "f2", name: "Two" },
      ])
    );

    await act(async () => {
      await result.current.importAllFolders();
    });

    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/folders/import?"))).toHaveLength(2);
    expect(result.current.msg?.text).toContain("Imported all");
  });
});
