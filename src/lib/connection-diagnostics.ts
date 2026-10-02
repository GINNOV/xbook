import { z } from "zod";

export function diagnosticEndpoint(value: string) {
  try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString().replace(/\/+$/, ""); }
  catch { return "the configured endpoint"; }
}
export function connectionFailure(error: unknown, endpoint?: string) {
  const parsed = z.object({ status: z.number().optional(), name: z.string().optional() }).safeParse(error);
  const status = parsed.success ? parsed.data.status : undefined;
  const destination = endpoint ? diagnosticEndpoint(endpoint) : "the provider";
  if (status === 401 || status === 403) return `Authorization failed at ${destination}. Check credentials in Settings and reconnect if expired.`;
  if (status === 404) return `Endpoint or model unavailable at ${destination}. Check the model name and OpenAI-compatible /v1 URL in Settings.`;
  if (status === 429) return `Provider limit reached at ${destination}. Wait before retrying and check provider quota.`;
  return `Connection test failed at ${destination}${status ? ` (HTTP ${status})` : ""}. Check the server, credentials and model, then retry.`;
}
export const modelEndpointSchema = z.string().trim().url().refine((value) => {
  const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, "Use an HTTP(S) endpoint without credentials or query parameters; put credentials in API key.");

export function providerFailure(error: unknown, endpoint: string) {
  const parsed = z.object({ status: z.number().optional(), code: z.string().optional(), name: z.string().optional() }).safeParse(error);
  const raw = error instanceof Error ? error.message : "";
  const status = parsed.success ? parsed.data.status : undefined;
  const statusFromMessage = raw.match(/\b(401|403|404|429|500|502|503|504)\b/)?.[1];
  const code = status ?? (statusFromMessage ? Number(statusFromMessage) : undefined);
  const destination = diagnosticEndpoint(endpoint);
  if (code) return `Provider request failed (HTTP ${code}) at ${destination}. ${code === 401 || code === 403 ? "Unauthorized. Check credentials in Settings." : code === 404 ? "Model or endpoint not found. Check Settings." : "Check provider availability and quota, then retry."}`;
  if (/ECONNREFUSED|Connection refused/i.test(raw)) return `Connection refused at ${destination}. Start the model server or correct the URL in Settings.`;
  if (/timeout|timed out/i.test(raw) || (parsed.success && /timeout/i.test(parsed.data.name ?? ""))) return `Provider request timed out at ${destination}. Check the model server and retry.`;
  if (/ECONNRESET|socket/i.test(raw)) return `Provider socket interrupted at ${destination}. Retry when the server is available.`;
  return `Provider request failed at ${destination}. Check the server, model and credentials in Settings.`;
}
