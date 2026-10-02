import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsForm from "@/app/components/SettingsForm";
import { SettingsProvider, useSettingsContext } from "@/app/hooks/settings/useSettingsContext";
import { connectionState, endpointDestination, validateSettingsDraft } from "@/app/lib/settings-draft";
import type { Settings } from "@/app/components/settings/types";

const initial: Settings = { llmModel: "saved-chat", llmBaseUrl: "http://127.0.0.1:1234/v1", llmEmbeddingModel: "embed", llmEmbeddingBaseUrl: "", llmApiKey: "fixture-secret", monthlyCap: 10, ytMonthlyCap: 10, enrichBatchSize: 25, llmConcurrency: 1, llmContextWindow: 128000, llmResponseLimit: 2000,
  xAccessToken: "expired-fixture", xTokenExpiresAt: "2020-01-01", ytAccessToken: "expired-fixture", ytTokenExpiresAt: "2020-01-01" };
const props = { initial, defaultPrompt: "fixture prompt", usedThisMonth: 0, agentApiBaseUrl: "http://localhost/api/agent", agentApiTokenConfigured: false,
  xDiagnostics: { hasAccessToken: true, hasRefreshToken: false, hasBearerToken: false, userId: "fixture", tokenExpiresAt: "2020-01-01", scope: null, apiBase: "https://api.x.com/2" } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { window.history.replaceState(null, "", "/settings?tab=ai"); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

it("tests exact drafts separately, preserves them across tabs and invalidates changed results", async () => {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (_url.includes("?take=")) return response({ runs: [] });
    const body = JSON.parse(String(options?.body)); sent.push(body);
    return body.type === "embedding" ? response({ ok: false, error: "Embedding model unavailable; load it and test again." }, 400) : response({ ok: true, message: "Fixture chat responded", testedAt: "2026-10-02" });
  }));
  render(<SettingsForm {...props} />);
  expect(screen.getByText("X: expired")).toBeVisible();
  expect(screen.getByText("YouTube: expired")).toBeVisible();
  expect(screen.getByText("Chat: configured, not tested")).toBeVisible();
  fireEvent.change(screen.getByLabelText("LLM model", { exact: true }), { target: { value: "draft-chat" } });
  fireEvent.click(screen.getByRole("button", { name: "Test chat with displayed values" }));
  await screen.findByText("Chat: tested");
  fireEvent.click(screen.getByRole("button", { name: "Test embeddings with displayed values" }));
  await screen.findByText("Embeddings: unavailable");
  expect(sent).toEqual([{ type: "llm", llmModel: "draft-chat", llmBaseUrl: initial.llmBaseUrl, llmApiKey: "fixture-secret" }, { type: "embedding", llmBaseUrl: initial.llmBaseUrl, llmApiKey: "fixture-secret", llmEmbeddingModel: "embed", llmEmbeddingBaseUrl: "" }]);
  fireEvent.click(screen.getByRole("tab", { name: /Limits/ }));
  fireEvent.click(screen.getByRole("tab", { name: /^AI/ }));
  expect(screen.getByLabelText("LLM model", { exact: true })).toHaveValue("draft-chat");
  expect(screen.getByText("Chat: tested")).toBeVisible();
  fireEvent.change(screen.getByLabelText("LLM model", { exact: true }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Test chat with displayed values" }));
  await screen.findByText("Chat: Enter the displayed model and endpoint before testing.");
  expect(sent).toHaveLength(2);
  expect(screen.queryByText("Chat: tested")).not.toBeInTheDocument();
});

it("marks presets dirty, preserves drafts on refresh, prevents invalid save, and reports save failure/success", async () => {
  let failure = true;
  const fetcher = vi.fn(async (url: string) => url.includes("?take=") ? response({ runs: [] }) : failure ? response({ error: "Fixture disk unavailable" }, 500) : response({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<SettingsForm {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Ollama" }));
  expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
  view.rerender(<SettingsForm {...props} initial={{ ...initial, llmModel: "new-server-model" }} />);
  expect(screen.getByLabelText("LLM base URL", { exact: true })).toHaveValue("http://127.0.0.1:11434/v1");
  fireEvent.click(screen.getByRole("tab", { name: /Limits/ }));
  fireEvent.change(screen.getByLabelText("Enrichment batch size", { exact: true }), { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/settings")).toHaveLength(0);
  expect(screen.getAllByText(/Enrichment batch size must be a whole number/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Enrichment batch size", { exact: true }), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByRole("alert", { name: "" });
  await screen.findByText("Fixture disk unavailable");
  expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
  failure = false;
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Settings saved.");
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
});

it("does not mark a new draft tested when an older request finishes", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider initial={initial} defaultPrompt="fixture">{children}</SettingsProvider>;
  const { result } = renderHook(() => useSettingsContext(), { wrapper });
  let pending!: Promise<void>;
  act(() => { pending = result.current.testConnection("llm"); });
  act(() => { result.current.setForm((previous) => ({ ...previous, llmModel: "new-draft" })); });
  await act(async () => { finish(response({ ok: true, message: "old success" })); await pending; });
  expect(connectionState("llm", result.current.form, result.current.connectionTests.llm)).toBe("configured");
  expect(result.current.isDirty).toBe(true);
});

it("keeps unrelated drafts when saved OAuth fields change and offers a discard choice on navigation", () => {
  vi.stubGlobal("confirm", vi.fn(() => false));
  const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider initial={initial} defaultPrompt="fixture">{children}</SettingsProvider>;
  const { result } = renderHook(() => useSettingsContext(), { wrapper });
  act(() => { result.current.setForm((previous) => ({ ...previous, llmModel: "unsaved-chat" })); });
  act(() => { result.current.applySavedPatch({ ytAccessToken: null, ytRefreshToken: null }); });
  expect(result.current.form.llmModel).toBe("unsaved-chat");
  expect(result.current.isDirty).toBe(true);
  const anchor = document.createElement("a"); anchor.href = "/bookmarks"; document.body.append(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(window.confirm).toHaveBeenCalledWith("Leave Settings and discard unsaved changes?");
  anchor.remove();
  act(() => { result.current.setForm((previous) => ({ ...previous, llmModel: initial.llmModel })); });
  expect(result.current.isDirty).toBe(false);
});

describe("numeric and privacy boundaries", () => {
  it.each([NaN, Infinity, -1, 0, 1.5, 201])("rejects invalid operation batch %s", (value) => { expect(validateSettingsDraft({ enrichBatchSize: value })).toContain("whole number"); });
  it("accepts bounded integers/defaults and hides URL auth/query from destination help", () => {
    expect(validateSettingsDraft({ enrichBatchSize: 200, llmConcurrency: 32, llmResponseLimit: 0 })).toBeNull();
    expect(endpointDestination("https://user:secret@example.com/v1?api_key=secret")).toEqual({ kind: "Remote", destination: "https://example.com/v1" });
    expect(endpointDestination("http://192.168.1.2/v1").kind).toBe("LAN");
    expect(endpointDestination("http://localhost:1234/v1").kind).toBe("Local");
  });
});
