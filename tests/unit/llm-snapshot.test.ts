// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { captureLlmConnection, getEffectiveEmbeddingIdentity, summarizeBookmark, answerLibraryQuestion, validateLlmConnection, generateEmbeddingResult } from "@/lib/llm";
import { logLlmRequest, logProcessingEvent } from "@/lib/processing";

const fixture = vi.hoisted(() => ({ settings: {
  id: "default", llmModel: "chat-old", llmBaseUrl: "", llmApiKey: "old-private-token",
  llmEmbeddingModel: "embed-old", llmEmbeddingBaseUrl: "", llmMaxTokens: 400,
  llmContextWindow: 2048, llmResponseLimit: 45, logLlmPayloads: false,
  llmPrompt: "ORIGINAL CUSTOM PROMPT", llmSystemPrompt: "ORIGINAL SYSTEM", llmThinkingEnabled: false,
} }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ ...fixture.settings }) }));
vi.mock("@/lib/processing", () => ({ logLlmRequest: vi.fn(), logProcessingEvent: vi.fn() }));

type ProviderRequest = { path: string; authorization: string | undefined; body: unknown };
let server: Server;
let origin: string;
let requests: ProviderRequest[];
let availableModels: string[];
let chatOverride: string | null = null;
let sectionMode = false;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const chunk of request) parts.push(Buffer.from(chunk));
    const text = Buffer.concat(parts).toString();
    requests.push({ path: request.url ?? "", authorization: request.headers.authorization, body: text ? JSON.parse(text) : null });
    response.setHeader("Content-Type", "application/json");
    if (request.url?.endsWith("/models")) {
      response.end(JSON.stringify({ object: "list", data: availableModels.map((id) => ({ id, object: "model" })) }));
    } else if (request.url?.endsWith("/embeddings")) {
      response.end(JSON.stringify({ object: "list", data: [{ object: "embedding", index: 0, embedding: Buffer.from(new Float32Array([1, 0]).buffer).toString("base64") }], model: "embed-old", usage: { prompt_tokens: 5, total_tokens: 5 } }));
    } else if (request.url?.endsWith("/chat/completions")) {
      response.end(JSON.stringify({ id: "fixture-response", object: "chat.completion", model: "chat-old", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: sectionMode && text.includes("Summarize this source section") ? JSON.stringify({ notes: text.includes("73 kelvin") ? "Cobalt calibration is 73 kelvin." : "General source context." }) : chatOverride ?? JSON.stringify({ summary: "A summary from the frozen connection.", category: "Testing", tags: ["snapshot"] }) } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { message: "Unexpected provider path" } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture listener");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  requests = []; chatOverride = null; sectionMode = false;
  availableModels = ["chat-old"];
  Object.assign(fixture.settings, {
    llmModel: "chat-old", llmBaseUrl: `${origin}/chat-old/v1`, llmApiKey: "old-private-token",
    llmEmbeddingModel: "embed-old", llmEmbeddingBaseUrl: `${origin}/embed-old/v1`, llmMaxTokens: 400,
    llmContextWindow: 2048, llmResponseLimit: 45, logLlmPayloads: false,
    llmPrompt: "ORIGINAL CUSTOM PROMPT", llmSystemPrompt: "ORIGINAL SYSTEM", llmThinkingEnabled: false,
  });
  vi.stubEnv("OPENAI_API_KEY", "environment-private-token");
});
afterEach(() => vi.unstubAllEnvs());

it("does not invent an embedding model or call a provider when embedding configuration is missing", async () => {
  fixture.settings.llmEmbeddingModel = ""; vi.stubEnv("OPENAI_EMBEDDING_MODEL", "");
  expect(await getEffectiveEmbeddingIdentity()).toBeUndefined();
  await expect(generateEmbeddingResult("Fixture source")).rejects.toThrow("Missing embedding model");
  expect(requests).toHaveLength(0);
  expect(await summarizeBookmark({ text: "A controlled experiment measured 73 kelvin." })).toMatchObject({ summary: expect.any(String), embedding: undefined });
  expect(requests.every((entry) => entry.path.endsWith("chat/completions"))).toBe(true);
});

function changeSavedSettings() {
  Object.assign(fixture.settings, {
    llmModel: "chat-new", llmBaseUrl: `${origin}/chat-new/v1`, llmApiKey: "rotated-private-token",
    llmEmbeddingModel: "embed-new", llmEmbeddingBaseUrl: `${origin}/embed-new/v1`, llmMaxTokens: 5,
    llmContextWindow: 1000, llmResponseLimit: 900, logLlmPayloads: true,
    llmPrompt: "CHANGED CUSTOM PROMPT", llmSystemPrompt: "CHANGED SYSTEM", llmThinkingEnabled: true,
  });
}

describe("captured LLM connection through the real OpenAI HTTP client", () => {
  it("freezes effective settings without persisting the authentication key", async () => {
    const snapshot = await captureLlmConnection();
    expect(snapshot).toEqual({ model: "chat-old", baseUrl: `${origin}/chat-old/v1`, maxTokens: 400,
      contextWindow: 2048, responseLimit: 45, logLlmPayloads: false, customPrompt: "ORIGINAL CUSTOM PROMPT",
      systemPrompt: "/no_think\nORIGINAL SYSTEM", thinking: false });
    changeSavedSettings();
    expect(snapshot.model).toBe("chat-old");
    const persisted = JSON.stringify({ llmConnection: snapshot });
    for (const secret of ["old-private-token", "rotated-private-token", "environment-private-token", "apiKey"]) {
      expect(persisted).not.toContain(secret);
    }
  });

  it("executes captured endpoints, models, prompts, input bounds and response/logging limits after settings change", async () => {
    const connection = await captureLlmConnection();
    const embeddingConnection = await getEffectiveEmbeddingIdentity();
    changeSavedSettings();
    const result = await summarizeBookmark({ connection, embeddingConnection,
      text: "A".repeat(40), sourceText: "B".repeat(60), processing: { runId: "frozen-run", bookmarkId: "bookmark" } });
    expect(requests.map((request) => request.path)).toEqual(["/chat-old/v1/chat/completions", "/embed-old/v1/embeddings"]);
    expect(requests[0].body).toMatchObject({ model: "chat-old", max_tokens: 45, messages: [
      { role: "system", content: "/no_think\nORIGINAL SYSTEM" },
      { role: "user", content: expect.stringContaining("ORIGINAL CUSTOM PROMPT") },
    ] });
    const chat = JSON.stringify(requests[0].body);
    expect(chat).toContain(`Text: ${"A".repeat(40)}`);
    expect(chat).toContain(`Linked content: ${"B".repeat(60)}`);
    expect(chat).not.toContain("CHANGED");
    expect(requests[1].body).toMatchObject({ model: "embed-old" });
    expect(requests.every((request) => request.authorization === "Bearer rotated-private-token")).toBe(true);
    expect(result.embeddingIdentity).toEqual({ model: "embed-old", endpoint: `${origin}/embed-old/v1`, dimensions: 2 });
    expect(logLlmRequest).toHaveBeenCalledWith(expect.objectContaining({ model: "chat-old", baseUrl: `${origin}/chat-old/v1`, includePayloads: false }));
    const persisted = JSON.stringify([vi.mocked(logLlmRequest).mock.calls, vi.mocked(logProcessingEvent).mock.calls, connection, embeddingConnection]);
    for (const secret of ["old-private-token", "rotated-private-token", "environment-private-token"]) expect(persisted).not.toContain(secret);
  });

  it("preflights the stored endpoint and selected model after settings change", async () => {
    const connection = await captureLlmConnection();
    changeSavedSettings();
    expect(await validateLlmConnection(undefined, connection)).toBe(true);
    expect(requests.map((request) => request.path)).toEqual(["/chat-old/v1/models"]);
    availableModels = ["chat-new"];
    await expect(validateLlmConnection(undefined, connection)).rejects.toThrow(/Model "chat-old" is not currently available/);
    expect(requests.every((request) => request.path === "/chat-old/v1/models")).toBe(true);
  });

  it("captures a new connection only when explicitly requested after a settings change", async () => {
    const first = await captureLlmConnection();
    changeSavedSettings();
    const second = await captureLlmConnection();
    expect(second).toMatchObject({ model: "chat-new", baseUrl: `${origin}/chat-new/v1`, responseLimit: 900,
      customPrompt: "CHANGED CUSTOM PROMPT", systemPrompt: "CHANGED SYSTEM", thinking: true });
    expect(first).toMatchObject({ model: "chat-old", thinking: false });
  });
  it("processes the tail through bounded section calls and final synthesis over actual HTTP", async () => {
    sectionMode = true;
    const connection = await captureLlmConnection();
    const sourceText = "General measured source context. ".repeat(1000) + " Cobalt calibration is 73 kelvin.";
    await summarizeBookmark({ connection, sourceText });
    const calls = requests.filter((request) => request.path.endsWith("/chat/completions"));
    expect(calls.length).toBeGreaterThan(2);
    expect(JSON.stringify(calls.at(-1)?.body)).toContain("73 kelvin");
    expect(calls.every((request) => JSON.stringify(request.body).length < connection.contextWindow * 4)).toBe(true);
  });
  it("keeps partial source method and limitations outside long-source reduction notes", async () => {
    sectionMode = true;
    const connection = await captureLlmConnection();
    await summarizeBookmark({ connection, sourceText: "General measured context. ".repeat(1500) + " Final calibration is 73 kelvin.",
      sourceCapture: { method: "description", language: "en", status: "partial", reason: "Caption capture failed; only the supplied description is available." } });
    const calls = requests.filter((request) => request.path.endsWith("/chat/completions"));
    expect(calls.length).toBeGreaterThan(2);
    const final = JSON.stringify(calls.at(-1)?.body);
    expect(final).toContain("Source method: description");
    expect(final).toContain("Completeness: partial");
    expect(final).toContain("only the supplied description is available");
    expect(final).toContain("Do not imply complete access");
    expect(final).toContain("73 kelvin");
  });
  it.each(["missing", "partial"])("declines unsupported title-only YouTube Ask with %s capture without calling the model", async (captureStatus) => {
    const result = await answerLibraryQuestion({ question: "What is the proven reactor temperature?", candidates: [{
      id: "title-only", source: "yt", tweetUrl: "https://youtube.com/watch?v=fixture", summary: "Unsupported generated preview 73 kelvin",
      text: "Video title: reactor breakthrough", category: null, authorUsername: null, sourceEvidence: [],
      captureStatus: captureStatus === "missing" ? "missing" : "partial", captureReason: "No factual source was captured.",
    }] });
    expect(result).toMatchObject({ answer: expect.stringContaining("Insufficient evidence"), citations: [] });
    expect(requests).toHaveLength(0);
  });
  it("reserves the configured system prompt before fitting Ask evidence", async () => {
    fixture.settings.llmSystemPrompt = "x".repeat(10000);
    expect(await answerLibraryQuestion({ question: "What was measured?", candidates: [{ id: "post", source: "x", tweetUrl: "https://x.com/fixture", summary: null,
      text: "A controlled reactor experiment measured 73 kelvin.", category: null, authorUsername: null }] })).toMatchObject({ citations: [], answer: expect.stringContaining("Insufficient evidence") });
    expect(requests).toHaveLength(0);
  });
  it("accepts only citations quoting supplied source evidence", async () => {
    chatOverride = JSON.stringify({ answer: "The calibration is 73 kelvin.", citations: [{ id: "video", reason: "Measurement", quote: "calibration is 73 kelvin" }] });
    const candidates = [{ id: "video", source: "yt", tweetUrl: "https://youtube.com/watch?v=fixture", summary: "Generated preview", text: null, category: null, authorUsername: null,
      sourceEvidence: [{ text: "The calibration is 73 kelvin.", startSeconds: 120, endSeconds: 124 }], captureStatus: "partial" as const }];
    expect((await answerLibraryQuestion({ question: "What is the calibration?", candidates })).citations[0].quote).toBe("calibration is 73 kelvin");
    for (const unsupported of [
      { answer: "Invented", citations: [{ id: "unknown", reason: "Other", quote: "calibration is 73 kelvin" }] },
      { answer: "Invented", citations: [{ id: "video", reason: "Other", quote: "91 kelvin" }] },
      { answer: "Invented", citations: [] },
    ]) {
      chatOverride = JSON.stringify(unsupported);
      expect(await answerLibraryQuestion({ question: "What is the calibration?", candidates })).toMatchObject({ answer: expect.stringContaining("Insufficient evidence"), citations: [] });
    }
  });

});
