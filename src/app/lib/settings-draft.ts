import { z } from "zod";
import type { Settings } from "../components/settings/types";
import { MAX_LLM_CONCURRENCY } from "@/lib/llm-limits";

export type ConnectionType = "llm" | "embedding" | "x" | "yt";
export type ConnectionTest = { fingerprint: string; status: "testing" | "tested" | "unavailable"; message: string; testedAt?: string };
export const numericSettings = {
  monthlyCap: { label: "X monthly cap", min: 1, max: 10000 },
  ytMonthlyCap: { label: "YouTube monthly cap", min: 1, max: 10000 },
  enrichBatchSize: { label: "Enrichment batch size", min: 1, max: 200 },
  llmConcurrency: { label: "LLM concurrency", min: 1, max: MAX_LLM_CONCURRENCY },
  llmMaxTokens: { label: "Maximum tokens", min: 1, max: 512000 },
  llmContextWindow: { label: "Context window", min: 1, max: 1000000 },
  llmResponseLimit: { label: "Response token limit", min: 0, max: 128000 },
} as const;
export function validateSettingsDraft(form: Settings) {
  for (const [key, rule] of Object.entries(numericSettings)) {
    const value = form[key as keyof typeof numericSettings];
    if (value === undefined || value === null) continue;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < rule.min || value > rule.max) return `${rule.label} must be a whole number from ${rule.min} to ${rule.max}.`;
  }
  return null;
}
export function connectionDraft(type: ConnectionType, form: Settings) {
  if (type === "x") return { type, xAccessToken: form.xAccessToken ?? null, xBearerToken: form.xBearerToken ?? null, xUserId: form.xUserId ?? null, xApiBase: form.xApiBase ?? "https://api.x.com/2" };
  if (type === "yt") return { type, ytAccessToken: form.ytAccessToken ?? null };
  if (type === "llm") return { type, llmModel: form.llmModel ?? null, llmBaseUrl: form.llmBaseUrl ?? null, llmApiKey: form.llmApiKey ?? null };
  return { type, llmBaseUrl: form.llmBaseUrl ?? null, llmApiKey: form.llmApiKey ?? null, llmEmbeddingModel: form.llmEmbeddingModel ?? null, llmEmbeddingBaseUrl: form.llmEmbeddingBaseUrl ?? null };
}
export function connectionFingerprint(type: ConnectionType, form: Settings) { return JSON.stringify(connectionDraft(type, form)); }
export function draftFingerprint(form: Settings) { return JSON.stringify(Object.entries(form).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))); }
export function connectionState(type: ConnectionType, form: Settings, test?: ConnectionTest) {
  if (test?.fingerprint === connectionFingerprint(type, form)) return test.status;
  if (type === "llm" || type === "embedding") return (type === "llm" ? form.llmModel : form.llmEmbeddingModel)?.trim() ? "configured" : "disconnected";
  const token = type === "x" ? form.xAccessToken : form.ytAccessToken;
  const expiry = type === "x" ? form.xTokenExpiresAt : form.ytTokenExpiresAt;
  if (!token) return "disconnected";
  if (expiry && new Date(expiry).getTime() <= Date.now()) return "expired";
  return "configured";
}
export const connectionResponseSchema = z.object({ ok: z.boolean().optional(), message: z.string().optional(), error: z.string().optional(), testedAt: z.string().optional() });
export function endpointDestination(value?: string | null) {
  try {
    const url = new URL(value ?? "");
    const host = url.hostname.toLowerCase();
    const local = host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);
    const lan = /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".local");
    return { kind: local ? "Local" : lan ? "LAN" : "Remote", destination: `${url.protocol}//${url.host}${url.pathname}` };
  } catch { return { kind: "Unconfigured", destination: "Enter an HTTP or HTTPS endpoint." }; }
}
