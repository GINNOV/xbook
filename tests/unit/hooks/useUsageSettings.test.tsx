import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUsageSettings } from "@/app/hooks/settings/useUsageSettings";
import { useSettingsContext } from "@/app/hooks/settings/useSettingsContext";

vi.mock("@/app/hooks/settings/useSettingsContext");

describe("useUsageSettings", () => {
  const mockSetMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSettingsContext).mockReturnValue({
      setMessage: mockSetMessage,
    } as any);
    localStorage.clear();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => String(url).includes("?take=") ? new Response(JSON.stringify({ runs: [] })) : new Response(JSON.stringify({ ok: true })));
  });

  it("should mark latest bookmark as baseline", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("?take=") ? new Response(JSON.stringify({ runs: [] })) : ({
      ok: true,
      json: async () => ({ ok: true }),
    } as any));

    const { result } = renderHook(() => useUsageSettings());

    await act(async () => {
      await result.current.markLatest();
    });

    expect(fetch).toHaveBeenCalledWith("/api/settings/mark-latest", { method: "POST" });
    expect(mockSetMessage).toHaveBeenCalledWith(expect.stringContaining("baseline"));
  });

  it("should reset sync baseline", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("?take=") ? new Response(JSON.stringify({ runs: [] })) : ({
      ok: true,
      json: async () => ({ ok: true }),
    } as any));

    const { result } = renderHook(() => useUsageSettings());

    await act(async () => {
      await result.current.resetBaseline();
    });

    expect(fetch).toHaveBeenCalledWith("/api/settings/reset-baseline", { method: "POST" });
    expect(mockSetMessage).toHaveBeenCalledWith(expect.stringContaining("reset"));
  });

  it("observes a complete embedding run and submits its full scope once", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(String(url).includes("?take=") ? { runs: [] } : { run: { id: "settings-embedding", source: null, type: "embedding_sync", status: "completed", total: 5, processed: 5, updated: 5, failed: 0, skipped: 0 } })));
    const { result } = renderHook(() => useUsageSettings());
    await act(async () => { await result.current.syncEmbeddings(); });
    expect(fetch).toHaveBeenCalledWith("/api/bookmarks/embeddings/sync?full=true", expect.objectContaining({ method: "POST", headers: { "Idempotency-Key": expect.any(String) } }));
    expect(mockSetMessage).toHaveBeenCalledWith(expect.stringContaining("5/5 updated"));
  });
});
