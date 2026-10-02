import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { getAuthContext } from "@/lib/x";
import { diagnosticEndpoint, modelEndpointSchema } from "@/lib/connection-diagnostics";

const DEFAULT_API_BASE = "https://api.x.com/2";
const RESPONSE_LIMIT = 65536;
const meSchema = z.object({ data: z.object({ id: z.string().min(1).max(128) }) });
const bookmarksSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(128) })).max(5).optional(), meta: z.object({ result_count: z.number().int().nonnegative().optional() }).optional() })
  .refine((value) => value.data !== undefined || value.meta?.result_count === 0);
type Probe = { status: number; ok: boolean; message: string };

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > RESPONSE_LIMIT) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("oversized");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > RESPONSE_LIMIT) throw new Error("oversized");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function probe(url: URL, token: string, signal: AbortSignal, schema: z.ZodType): Promise<Probe> {
  signal.throwIfAborted();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal });
  signal.throwIfAborted();
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, ok: false, message: response.status === 401 || response.status === 403
      ? "X authorization failed. Reconnect in Settings → Connections."
      : response.status === 429 ? "X provider quota reached. Wait and retry; check the provider quota."
        : "X provider request failed. Check the configured API endpoint and provider availability, then retry." };
  }
  try {
    const parsed = schema.safeParse(await boundedJson(response, signal));
    return { status: response.status, ok: parsed.success, message: parsed.success ? "X access verified." : "X returned an unexpected response. Check the API endpoint and retry." };
  } catch {
    signal.throwIfAborted();
    return { status: response.status, ok: false, message: "X returned an invalid or oversized response. Check the API endpoint and retry." };
  }
}

export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  const probes: { me: Probe | null; bookmarks: Probe | null } = { me: null, bookmarks: null };
  let summary: { hasAccessToken: boolean; hasRefreshToken: boolean; hasBearerToken: boolean; hasUserId: boolean; tokenExpiresAt: string | null; apiBase: string } | null = null;
  let authorizing = true;
  try {
    signal.throwIfAborted();
    const settings = await getSettings();
    const configuredBase = settings.xApiBase ?? process.env.X_API_BASE ?? DEFAULT_API_BASE;
    summary = { hasAccessToken: Boolean(settings.xAccessToken), hasRefreshToken: Boolean(settings.xRefreshToken), hasBearerToken: Boolean(settings.xBearerToken), hasUserId: Boolean(settings.xUserId),
      tokenExpiresAt: settings.xTokenExpiresAt?.toISOString() ?? null, apiBase: diagnosticEndpoint(configuredBase) };
    const parsedBase = modelEndpointSchema.safeParse(configuredBase);
    if (!parsedBase.success) return NextResponse.json({ ok: false, summary, probes, error: "Use an HTTP(S) X API endpoint without URL credentials or query parameters. Save it in Settings → Connections." }, { status: 400 });
    const auth = await getAuthContext(signal);
    signal.throwIfAborted();
    if (!modelEndpointSchema.safeParse(auth.apiBase).success) throw new Error("Invalid X auth endpoint");
    authorizing = false;
    const base = auth.apiBase.replace(/\/+$/, "");
    summary = { ...summary, hasAccessToken: true, hasUserId: Boolean(auth.userId), apiBase: diagnosticEndpoint(base) };
    probes.me = await probe(new URL(`${base}/users/me?user.fields=id`), auth.token, signal, meSchema);
    if (probes.me.ok) {
      const bookmarksUrl = new URL(`${base}/users/${encodeURIComponent(auth.userId)}/bookmarks`);
      bookmarksUrl.searchParams.set("max_results", "5");
      probes.bookmarks = await probe(bookmarksUrl, auth.token, signal, bookmarksSchema);
    }
    const ok = Boolean(probes.me.ok && probes.bookmarks?.ok);
    return NextResponse.json({ ok, summary, probes, ...(ok ? {} : { error: probes.me.ok ? probes.bookmarks?.message : probes.me.message }) });
  } catch {
    return NextResponse.json({ ok: false, summary, probes, error: request.signal.aborted
      ? "X diagnostics cancelled. Saved credentials and library items were preserved."
      : signal.aborted ? "X diagnostics timed out. Check provider availability and retry. Saved library items were preserved."
        : authorizing ? "X authorization is unavailable or expired. Reconnect in Settings → Connections; saved library items were preserved."
          : "X diagnostics failed. Check the API endpoint and provider availability, then retry." }, { status: request.signal.aborted ? 499 : signal.aborted ? 504 : authorizing ? 401 : 502 });
  }
}
