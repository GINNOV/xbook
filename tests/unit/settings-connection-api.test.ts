// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { POST as testConnection } from "@/app/api/settings/test/route";
import { POST as saveSettings } from "@/app/api/settings/route";
import { updateSettings } from "@/lib/settings";
const saved = vi.hoisted(() => ({ llmModel: "saved-chat", llmBaseUrl: "http://unreachable.invalid/v1", llmEmbeddingModel: "saved-embed", llmEmbeddingBaseUrl: "http://unreachable.invalid/v1", llmApiKey: "saved-private-token" }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => saved, updateSettings: vi.fn(async (input) => input) }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: vi.fn(async (callback) => callback({ $executeRaw: vi.fn(), oAuthSession: { deleteMany: vi.fn() } })) } }));
vi.mock("@/lib/youtube", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/x", () => ({ X_OAUTH_REQUIRED_MESSAGE: "Connect OAuth", formatXApiError: () => "X API error. Reconnect in Settings." }));
let server: Server; let endpoint: string; let requests: { model: string; authorization: string | undefined; maxTokens?: number; path: string }[];
let vector: number[]; let status: number;
beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = z.object({ model: z.string(), max_tokens: z.number().optional() }).parse(JSON.parse(Buffer.concat(chunks).toString()));
    requests.push({ model: body.model, authorization: request.headers.authorization, maxTokens: body.max_tokens, path: request.url ?? "" });
    response.setHeader("Content-Type", "application/json"); response.statusCode = status;
    response.end(JSON.stringify(status !== 200 ? { error: { message: "Authorization secret=private-provider-secret Bearer private-key" } } : request.url?.endsWith("embeddings") ? { data: [{ index: 0, embedding: vector }] } : { choices: [{ message: { content: "ok" } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener"); endpoint = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { requests = []; vector = [1, 0]; status = 200; vi.clearAllMocks(); });
const request = (body: unknown) => new Request("http://localhost/api/settings/test", { method: "POST", body: JSON.stringify(body) });
describe("displayed draft connection tests", () => {
  it("uses chat draft model, URL and explicitly blank key; bounds the small test", async () => {
    const response = await testConnection(request({ type: "llm", llmModel: "draft-chat", llmBaseUrl: endpoint, llmApiKey: "", llmMaxTokens: 500000 }));
    expect(response.status).toBe(200); expect(requests).toEqual([{ model: "draft-chat", authorization: "Bearer lm-studio", maxTokens: 16, path: "/v1/chat/completions" }]);
  });
  it("uses displayed chat URL when displayed embedding URL is blank, never saved embedding URL", async () => {
    expect((await testConnection(request({ type: "embedding", llmEmbeddingModel: "draft-embed", llmEmbeddingBaseUrl: "", llmBaseUrl: endpoint, llmApiKey: "draft-key" }))).status).toBe(200);
    expect(requests[0]).toEqual({ model: "draft-embed", authorization: "Bearer draft-key", maxTokens: undefined, path: "/v1/embeddings" });
  });
  it("rejects explicitly empty model/endpoint without using saved values or making a call", async () => {
    for (const body of [{ type: "llm", llmModel: "", llmBaseUrl: endpoint }, { type: "embedding", llmEmbeddingModel: null, llmBaseUrl: endpoint }, { type: "llm", llmModel: "draft", llmBaseUrl: "" }]) expect((await testConnection(request(body))).status).toBe(400);
    expect(requests).toHaveLength(0);
  });
  it("rejects invalid vectors independently of a successful chat test", async () => {
    expect((await testConnection(request({ type: "llm", llmModel: "draft", llmBaseUrl: endpoint }))).status).toBe(200);
    vector = [0, 0]; expect((await testConnection(request({ type: "embedding", llmEmbeddingModel: "draft", llmEmbeddingBaseUrl: endpoint }))).status).toBe(400);
  });
  it("does not leak provider error payloads or retry authorization failures", async () => {
    status = 401; const response = await testConnection(request({ type: "llm", llmModel: "draft", llmBaseUrl: endpoint, llmApiKey: "private-key" }));
    const text = await response.text(); expect(response.status).toBe(400); expect(text).toContain("Authorization failed"); expect(text).not.toMatch(/private-provider-secret|private-key/); expect(requests).toHaveLength(1);
  });
});
describe("partial Settings saves", () => {
  it("preserves unspecified OAuth expiry dates", async () => {
    expect((await saveSettings(request({ llmModel: "changed" }))).status).toBe(200);
    expect(updateSettings).toHaveBeenCalledWith({ llmModel: "changed" });
  });
  it("accepts explicit disconnect null and rejects bad dates/numbers without writes", async () => {
    expect((await saveSettings(request({ xTokenExpiresAt: null }))).status).toBe(200);
    expect(updateSettings).toHaveBeenLastCalledWith({ xTokenExpiresAt: null }); vi.clearAllMocks();
    for (const body of [{ ytTokenExpiresAt: "not-a-date" }, { llmConcurrency: 0 }, { enrichBatchSize: -1 }, { llmBaseUrl: "http://user:private-secret@localhost/v1" }, { llmEmbeddingBaseUrl: "http://localhost/v1?api_key=private-secret" }]) expect((await saveSettings(request(body))).status).toBe(400);
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
