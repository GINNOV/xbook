import { act, renderHook, waitFor, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOperationObserver } from "@/app/hooks/useOperationObserver";
import OperationStatus from "@/app/components/OperationStatus";
import { operationMessage, operationProgress } from "@/app/lib/operation-observer";

function fixture(status = "running", updated = 0, failed = 0) {
  return { id: "persisted-run", source: "x", type: "enrichment_full", status, total: 4, processed: updated + failed, updated, failed, skipped: 0, notes: null,
    jobJson: JSON.stringify({ kind: "enrich", scope: { folderId: null }, items: Array.from({ length: 4 }, (_, index) => ({ status: index < updated ? "updated" : index < updated + failed ? "failed" : "pending" })), error: status === "paused" ? "Model unavailable" : null, repairAction: status === "paused" ? "/settings?tab=ai" : null }) };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("durable operation browser observer", () => {
  it("submits once with idempotency and reads cumulative snapshots until completion", async () => {
    let run = fixture();
    const requests: { url: string; options?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      requests.push({ url, options });
      if (url.includes("?take=")) return response({ runs: [] });
      if (url.startsWith("/api/enrich")) return response({ runId: run.id }, 202);
      return response({ run });
    }));
    const { result, unmount } = renderHook(() => useOperationObserver({ source: "x" }));
    await act(async () => { await Promise.resolve(); });
    let completion: ReturnType<typeof result.current.submit>;
    await act(async () => { completion = result.current.submit("/api/enrich?source=x&full=true"); await Promise.resolve(); });
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(requests.filter((request) => request.options?.method === "POST")).toHaveLength(1);
    expect(requests.find((request) => request.options?.method === "POST")?.options?.headers).toEqual({ "Idempotency-Key": expect.any(String) });
    run = fixture("running", 2);
    await waitFor(() => expect(result.current.run?.updated).toBe(2), { timeout: 2500 });
    expect(operationProgress(result.current.run!).remaining).toBe(2);
    run = fixture("completed", 4);
    await waitFor(() => expect(result.current.run?.updated).toBe(4), { timeout: 2500 });
    expect((await completion!)?.updated).toBe(4);
    expect(requests.filter((request) => request.options?.method === "POST")).toHaveLength(1);
    expect(operationMessage(run)).toContain("4/4 updated");
    unmount();
  });

  it("navigation detaches without stopping and a new mount reconnects to the same run", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      requests.push(`${options?.method ?? "GET"} ${url}`);
      if (url.includes("?take=")) return response({ runs: [fixture("running", 1)] });
      return response({ run: fixture("running", 2) });
    }));
    const first = renderHook(() => useOperationObserver({ source: "x" }));
    await waitFor(() => expect(first.result.current.run?.id).toBe("persisted-run"));
    first.unmount();
    const second = renderHook(() => useOperationObserver({ source: "x" }));
    await waitFor(() => expect(second.result.current.run?.updated).toBe(2));
    expect(requests.every((request) => request.startsWith("GET"))).toBe(true);
    second.unmount();
  });

  it("recovers a lost observation connection without another submission", async () => {
    let reads = 0;
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (url.includes("?take=")) return response({ runs: [fixture()] });
      if (++reads === 1) throw new Error("offline");
      return response({ run: fixture("completed", 4) });
    });
    vi.stubGlobal("fetch", fetcher);
    const { result, unmount } = renderHook(() => useOperationObserver({ source: "x" }));
    await waitFor(() => expect(result.current.connectionError).toContain("Reconnecting automatically"));
    await waitFor(() => expect(result.current.run?.status).toBe("completed"), { timeout: 2500 });
    expect(result.current.connectionError).toBeNull();
    expect(fetcher.mock.calls.every(([, options]) => options === undefined || options.method !== "POST")).toBe(true);
    unmount();
  });

  it("offers actionable paused recovery and sends resume/stop to the original ID", async () => {
    let run = fixture("paused", 1);
    const actions: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const action = JSON.parse(String(options.body)).action;
        actions.push(`${url}:${action}`);
        run = fixture(action === "resume" ? "running" : "stopped", 1);
      }
      return response({ run });
    }));
    const { result, unmount } = renderHook(() => useOperationObserver({ initialRunId: run.id }));
    await waitFor(() => expect(result.current.run?.status).toBe("paused"));
    const view = render(<OperationStatus operation={result.current} />);
    expect(screen.getByRole("link", { name: "Repair settings" })).toHaveAttribute("href", "/settings?tab=ai");
    expect(screen.getByRole("button", { name: "Resume operation" })).toBeVisible();
    await act(async () => { await result.current.resume(); });
    view.rerender(<OperationStatus operation={result.current} />);
    expect(screen.queryByRole("link", { name: "Repair settings" })).not.toBeInTheDocument();
    await act(async () => { await result.current.stop(); });
    expect(actions).toEqual(["/api/processing/runs/persisted-run:resume", "/api/processing/runs/persisted-run:stop"]);
    view.unmount(); unmount();
  });
});
