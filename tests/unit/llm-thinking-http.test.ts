// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { translateText } from "@/lib/llm";
import { getSettings } from "@/lib/settings";

vi.mock("@/lib/settings", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/processing", () => ({ logProcessingEvent: vi.fn(), logLlmRequest: vi.fn() }));
const requestSchema = z.object({ model: z.string(), messages: z.array(z.object({ role: z.string(), content: z.string() })),
  chat_template_kwargs: z.object({ enable_thinking: z.boolean() }).optional() });
let server: Server;
let endpoint: string;
let owner = "sglang";
let model = "qwen3.8-test";
let registryRequests = 0;
let registryAvailable = true;
const requests: z.infer<typeof requestSchema>[] = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      registryRequests++;
      if (!registryAvailable) { res.writeHead(403); res.end(JSON.stringify({ error: { message: "Registry unavailable" } })); return; }
      res.end(JSON.stringify({ data: [{ id: model, owned_by: owner }] })); return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(requestSchema.parse(JSON.parse(raw)));
    res.end(JSON.stringify({ choices: [{ message: { content: "Il backup è stato completato alle 03:15." }, finish_reason: "stop" }], usage: { total_tokens: 12 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback listener");
  endpoint = `http://127.0.0.1:${address.port}/v1`;
});
beforeEach(() => {
  requests.length = 0; registryRequests = 0; registryAvailable = true; owner = "sglang"; model = "qwen3.8-test";
  vi.mocked(getSettings).mockImplementation(async () => ({ id: "default", llmModel: model, llmBaseUrl: endpoint,
    llmApiKey: "synthetic", llmThinkingEnabled: false, llmResponseLimit: 1200, llmMaxTokens: 1200, llmContextWindow: 8192 }));
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
async function translate() { return translateText({ text: "The backup completed at 03:15.", targetLanguage: "Italian" }); }
describe("native thinking controls and translation output", () => {
  it("disables SGLang Qwen thinking and requests plain translation instead of the default JSON digest", async () => {
    expect(await translate()).toContain("03:15");
    expect(registryRequests).toBe(1);
    expect(requests[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(requests[0].messages[0].content).toContain("Return only the requested translated text");
    expect(requests[0].messages[0].content).not.toContain("Return only compact valid JSON");
  });
  it("preserves enabled thinking on a supported vLLM Qwen backend", async () => {
    owner = "vllm";
    vi.mocked(getSettings).mockResolvedValue({ id: "default", llmModel: model, llmBaseUrl: endpoint, llmThinkingEnabled: true });
    await translate();
    expect(requests[0].chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(requests[0].messages[0].content).not.toContain("/no_think");
  });
  it("does not send vendor-only options to another provider", async () => {
    owner = "other-provider";
    await translate();
    expect(requests[0].chat_template_kwargs).toBeUndefined();
  });
  it("still translates when a provider allows chat but denies its model registry", async () => {
    registryAvailable = false;
    await translate();
    expect(requests[0].chat_template_kwargs).toBeUndefined();
  });
  it("retains custom system instructions and skips Qwen metadata for unrelated models", async () => {
    model = "other-model";
    vi.mocked(getSettings).mockResolvedValue({ id: "default", llmModel: model, llmBaseUrl: endpoint, llmSystemPrompt: "Use a formal tone.", llmThinkingEnabled: false });
    await translate();
    expect(registryRequests).toBe(0);
    expect(requests[0].messages[0].content).toContain("Use a formal tone.");
    expect(requests[0].chat_template_kwargs).toBeUndefined();
  });
});
