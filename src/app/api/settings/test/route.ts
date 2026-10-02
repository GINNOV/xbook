import { NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { getSettings } from "@/lib/settings";
import { X_OAUTH_REQUIRED_MESSAGE, formatXApiError } from "@/lib/x";
import { getAuthContext } from "@/lib/youtube";
import { validateEmbeddingVector } from "@/lib/embedding-vector";
import { connectionFailure, modelEndpointSchema } from "@/lib/connection-diagnostics";

const schema = z.object({
  type: z.enum(["x", "yt", "llm", "embedding"]),
  llmEmbeddingModel: z.string().optional().nullable(), llmEmbeddingBaseUrl: z.string().optional().nullable(),
  xBearerToken: z.string().optional().nullable(), xUserId: z.string().optional().nullable(),
  xApiBase: z.string().optional().nullable(), xAccessToken: z.string().optional().nullable(),
  ytAccessToken: z.string().optional().nullable(), llmBaseUrl: z.string().optional().nullable(),
  llmApiKey: z.string().optional().nullable(), llmModel: z.string().optional().nullable(),
  llmMaxTokens: z.coerce.number().int().min(1).max(512000).optional().nullable(),
});
const draft = (value: string | null | undefined, saved?: string | null) => (value === undefined ? saved : value)?.trim() ?? "";
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid test request." }, { status: 400 });
  const data = parsed.data;
  const settings = await getSettings();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  let endpoint: string | undefined;
  try {
    if (data.type === "x") {
      const token = draft(data.xAccessToken, settings.xAccessToken);
      const userId = draft(data.xUserId, settings.xUserId);
      if (!token || !userId) return NextResponse.json({ ok: false, error: !token && draft(data.xBearerToken, settings.xBearerToken) ? X_OAUTH_REQUIRED_MESSAGE : "Missing X OAuth access token or user ID. Reconnect in Settings." }, { status: 400 });
      endpoint = modelEndpointSchema.parse(draft(data.xApiBase, settings.xApiBase ?? "https://api.x.com/2"));
      const url = new URL(`${endpoint.replace(/\/+$/, "")}/users/${encodeURIComponent(userId)}`);
      url.searchParams.set("user.fields", "id,name,username");
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!response.ok) return NextResponse.json({ ok: false, error: formatXApiError(response.status, "") }, { status: 400 });
      const account = z.object({ data: z.object({ username: z.string().optional() }) }).parse(await response.json());
      return NextResponse.json({ ok: true, type: data.type, testedAt: new Date().toISOString(), message: `Connected as ${account.data.username ?? "X user"}.` });
    }
    if (data.type === "yt") {
      const token = data.ytAccessToken === undefined ? (await getAuthContext(signal)).accessToken : draft(data.ytAccessToken);
      if (!token) return NextResponse.json({ ok: false, error: "Missing YouTube access token. Reconnect in Settings." }, { status: 400 });
      endpoint = "https://www.googleapis.com/youtube/v3";
      const response = await fetch(`${endpoint}/channels?part=snippet&mine=true&maxResults=1`, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!response.ok) return NextResponse.json({ ok: false, error: connectionFailure({ status: response.status }, endpoint) }, { status: 400 });
      const account = z.object({ items: z.array(z.object({ snippet: z.object({ title: z.string() }) })) }).parse(await response.json());
      return NextResponse.json({ ok: true, type: data.type, testedAt: new Date().toISOString(), message: `Connected as ${account.items[0]?.snippet.title ?? "YouTube account"}.` });
    }
    const chatBase = draft(data.llmBaseUrl, settings.llmBaseUrl ?? "http://localhost:1234/v1");
    const embeddingBase = draft(data.llmEmbeddingBaseUrl, settings.llmEmbeddingBaseUrl);
    endpoint = modelEndpointSchema.parse(data.type === "embedding" ? embeddingBase || chatBase : chatBase).replace(/\/+$/, "");
    const model = data.type === "embedding" ? draft(data.llmEmbeddingModel, settings.llmEmbeddingModel) : draft(data.llmModel, settings.llmModel);
    if (!model) return NextResponse.json({ ok: false, error: `Missing ${data.type === "embedding" ? "embedding" : "chat"} model in the displayed draft.` }, { status: 400 });
    const client = new OpenAI({ apiKey: draft(data.llmApiKey, settings.llmApiKey) || "lm-studio", baseURL: endpoint, timeout: 10_000, maxRetries: 0 });
    let message: string;
    if (data.type === "embedding") {
      const response = await client.embeddings.create({ model, input: "xbook embedding test", encoding_format: "float" }, { signal });
      const vector = validateEmbeddingVector(response.data[0]?.embedding ?? []);
      message = `Embedding model responded (${vector.length} dimensions).`;
    } else {
      const response = await client.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with: ok" }], temperature: 0, max_tokens: 16 }, { signal });
      if (!response.choices[0]?.message?.content?.trim()) throw new Error("Empty chat response");
      message = "Chat model returned a nonempty response.";
    }
    return NextResponse.json({ ok: true, type: data.type, testedAt: new Date().toISOString(), message });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof z.ZodError ? error.issues[0]?.message : connectionFailure(error, endpoint) }, { status: 400 });
  }
}
