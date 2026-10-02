import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBookmarksList, Bookmark } from "@/app/hooks/useBookmarksList";

global.fetch = vi.fn();

const mockBookmarks: Bookmark[] = [
  {
    id: "1", source: "x", tweetUrl: "https://x.com/1", text: "test 1", summary: "sum 1", category: "AI", tags: "a,b",
    authorUsername: "user1", importedAt: "2026-04-24T00:00:00Z", createdAt: "2026-04-24T00:00:00Z", summarizedAt: "2026-04-24T00:00:00Z",
    editedAt: null, readAt: null,
  },
];

describe("useBookmarksList hook", () => {
  beforeEach(() => { vi.mocked(fetch).mockReset(); localStorage.clear(); });

  it("should initialize with items", () => {
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    expect(result.current.items).toEqual(mockBookmarks);
  });

  it("should toggle read state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ bookmark: { ...mockBookmarks[0], readAt: "now" } }) } as any);
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    await act(async () => { await result.current.toggleRead(mockBookmarks[0]); });
    expect(fetch).toHaveBeenCalledWith("/api/bookmarks/read", expect.anything());
    expect(result.current.items[0].readAt).toBe("now");
  });

  it("should handle translation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ translatedText: "Hola" }) } as any);
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    act(() => result.current.setSelectedId("1"));
    await act(async () => { await result.current.translate("1"); });
    expect(result.current.translatedText).toBe("Hola");
  });

  it("observes single-item processing and fetches the resulting bookmark", async () => {
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    vi.mocked(fetch).mockResolvedValueOnce(response({ run: { id: "single-run", type: "single_reprocess", status: "completed", source: "x", total: 1, updated: 1, processed: 1, failed: 0, skipped: 0 } }));
    vi.mocked(fetch).mockResolvedValueOnce(response({ bookmark: { ...mockBookmarks[0], summary: "new", error: null, captureJson: null, summarySource: null } }));
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    await act(async () => { await result.current.reprocess("1"); });
    expect(fetch).toHaveBeenCalledWith("/api/enrich/one?bookmarkId=1", { method: "POST", headers: { "Idempotency-Key": expect.any(String) } });
    expect(fetch).toHaveBeenCalledWith("/api/bookmarks/1");
    expect(result.current.items[0].summary).toBe("new");
  });

  it("should save edit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ bookmark: { ...mockBookmarks[0], summary: "edit" } }) } as any);
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    act(() => { result.current.openEdit(mockBookmarks[0]); });
    act(() => { result.current.setEditing({ ...result.current.editing!, summary: "edit" }); });
    await act(async () => { await result.current.saveEdit(); });
    expect(fetch).toHaveBeenCalledWith("/api/enrich/edit", expect.objectContaining({
      body: JSON.stringify({ bookmarkId: "1", summary: "edit", category: "AI", tags: "a,b" }),
    }));
    expect(result.current.items[0].summary).toBe("edit");
  });

  it("should handle failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "fail" }), { status: 500 }));
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    await act(async () => { await result.current.reprocess("1"); });
    expect(result.current.message).toBe("fail");
  });
});

function deferredResponse() { let resolve!: (value: Response) => void; const promise = new Promise<Response>((done) => { resolve = done; }); return { promise, resolve }; }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const second = { ...mockBookmarks[0], id: "2", summary: "Second valid summary" };
const both = [...mockBookmarks, second];

describe("bookmark response ownership", () => {
  beforeEach(() => { vi.mocked(fetch).mockReset(); localStorage.clear(); });
  it("rejects a translation from an earlier A selection even after A-B-A", async () => {
    const old = deferredResponse(); vi.mocked(fetch).mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useBookmarksList(both));
    act(() => result.current.setSelectedId("1"));
    let pending!: Promise<void>; act(() => { pending = result.current.translate("1"); });
    act(() => result.current.setSelectedId("2")); act(() => result.current.setSelectedId("1"));
    await act(async () => { old.resolve(response({ translatedText: "Stale" })); await pending; });
    expect(result.current.translatedText).toBeNull();
    expect(result.current.isTranslating).toBe(false);
  });
  it("retains a valid translation after failure and retries the selected bookmark", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ translatedText: "Saved translation" })).mockResolvedValueOnce(response({ error: "Offline" }, 503)).mockResolvedValueOnce(response({ translatedText: "Repaired translation" }));
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    act(() => result.current.setSelectedId("1"));
    await act(async () => { await result.current.translate("1"); });
    await act(async () => { await result.current.translate("1"); });
    expect(result.current.translatedText).toBe("Saved translation");
    expect(result.current.feedbacks[0].text).toBe("Offline");
    await act(async () => { await result.current.feedbacks[0].retry?.(); });
    expect(result.current.translatedText).toBe("Repaired translation");
  });
  it("late read responses cannot overwrite a newer human edit", async () => {
    const read = deferredResponse(); vi.mocked(fetch).mockReturnValueOnce(read.promise).mockResolvedValueOnce(response({ bookmark: { ...mockBookmarks[0], summary: "Human edit", editedAt: "now" } }));
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    let pending!: Promise<void>; act(() => { pending = result.current.toggleRead(mockBookmarks[0]); result.current.openEdit(mockBookmarks[0]); });
    await act(async () => { await result.current.saveEdit(); });
    await act(async () => { read.resolve(response({ bookmark: { ...mockBookmarks[0], readAt: "read now" } })); await pending; });
    expect(result.current.items[0]).toMatchObject({ summary: "Human edit", readAt: "read now", editedAt: "now" });
  });
  it("saving A cannot dismiss the new B editor", async () => {
    const save = deferredResponse(); vi.mocked(fetch).mockReturnValueOnce(save.promise);
    const { result } = renderHook(() => useBookmarksList(both));
    act(() => result.current.openEdit(mockBookmarks[0]));
    let pending!: Promise<void>; act(() => { pending = result.current.saveEdit(); });
    act(() => { result.current.closeEdit(); result.current.openEdit(second); });
    await act(async () => { save.resolve(response({ bookmark: { ...mockBookmarks[0], summary: "Saved A" } })); await pending; });
    expect(result.current.editing?.id).toBe("2"); expect(result.current.items[0].summary).toBe("Saved A");
  });
  it("wrong read response ID preserves prior data and offers retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ bookmark: { id: "2", readAt: "now" } }));
    const { result } = renderHook(() => useBookmarksList(mockBookmarks));
    await act(async () => { await result.current.toggleRead(mockBookmarks[0]); });
    expect(result.current.items).toEqual(mockBookmarks); expect(result.current.feedbacks[0].retry).toBeTypeOf("function");
  });
});

it("a late generated response cannot replace a newer manual save", async () => {
  const fetchGenerated = deferredResponse();
  vi.mocked(fetch).mockReset(); localStorage.clear();
  vi.mocked(fetch).mockResolvedValueOnce(response({ run: { id: "r9-run", type: "single_reprocess", source: "x", status: "completed", total: 1, processed: 1, updated: 1, failed: 0, skipped: 0 } })).mockReturnValueOnce(fetchGenerated.promise).mockResolvedValueOnce(response({ bookmark: { ...mockBookmarks[0], summary: "New human correction", editedAt: "now" } }));
  const { result } = renderHook(() => useBookmarksList(mockBookmarks));
  let processing!: Promise<void>;
  await act(async () => { processing = result.current.reprocess("1"); await Promise.resolve(); await Promise.resolve(); });
  act(() => result.current.openEdit(mockBookmarks[0]));
  await act(async () => { await result.current.saveEdit(); });
  await act(async () => { fetchGenerated.resolve(response({ bookmark: { ...mockBookmarks[0], summary: "Old generation", error: null, captureJson: null, summarySource: null } })); await processing; });
  expect(result.current.items[0].summary).toBe("New human correction");
});
