import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { AppSettings } from "./settings";

export type OAuthProvider = "x" | "yt";
export const tokenSchema = z.object({
  access_token: z.string().trim().min(1).max(16384),
  refresh_token: z.string().trim().min(1).max(16384).optional(),
  expires_in: z.number().int().positive().max(31536000),
  token_type: z.string().regex(/^bearer$/i),
  scope: z.string().max(16384).optional(),
});
export type OAuthTokens = z.infer<typeof tokenSchema>;

/** Bounds both headers and body; cancellation is checked even when a mock/provider ignores it. */
export async function oauthJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  bounded.throwIfAborted();
  const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: bounded });
  bounded.throwIfAborted();
  if (!response.ok) {
    // Provider bodies can contain tokens, client secrets or codes. Never echo them.
    await response.body?.cancel();
    throw new Error(`OAuth provider request failed (${response.status}). Reconnect in Settings → Connections if authorization expired; otherwise retry.`);
  }
  if (Number(response.headers.get("content-length")) > 65536) {
    await response.body?.cancel();
    throw new Error("OAuth provider response is too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OAuth provider returned an empty response.");
  const chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  bounded.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      bounded.throwIfAborted();
      const chunk = await reader.read();
      bounded.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 65536) throw new Error("OAuth provider response is too large.");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error("OAuth provider returned malformed JSON. Stored credentials were preserved; retry or reconnect in Settings."); }
  } finally {
    bounded.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requestOAuthTokens(url: string, init: RequestInit, signal?: AbortSignal) {
  const parsed = tokenSchema.safeParse(await oauthJson(url, init, signal));
  if (!parsed.success) throw new Error("OAuth provider returned invalid tokens. Stored credentials were preserved; retry or reconnect in Settings.");
  return parsed.data;
}

export function credentialWhere(provider: OAuthProvider, snapshot: AppSettings): Prisma.SettingsWhereInput {
  return provider === "x" ? {
    id: "default", xAccessToken: snapshot.xAccessToken ?? null, xRefreshToken: snapshot.xRefreshToken ?? null,
    xTokenExpiresAt: snapshot.xTokenExpiresAt ?? null, xClientId: snapshot.xClientId ?? null,
    xClientSecret: snapshot.xClientSecret ?? null, xRedirectUri: snapshot.xRedirectUri ?? null,
    xApiBase: snapshot.xApiBase ?? null, xUserId: snapshot.xUserId ?? null,
  } : {
    id: "default", ytAccessToken: snapshot.ytAccessToken ?? null, ytRefreshToken: snapshot.ytRefreshToken ?? null,
    ytTokenExpiresAt: snapshot.ytTokenExpiresAt ?? null, ytClientId: snapshot.ytClientId ?? null,
    ytClientSecret: snapshot.ytClientSecret ?? null, ytRedirectUri: snapshot.ytRedirectUri ?? null,
  };
}

export function tokenUpdate(provider: OAuthProvider, tokens: OAuthTokens, snapshot: AppSettings, preserveRefresh = true): Prisma.SettingsUpdateManyMutationInput {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  return provider === "x" ? {
    xAccessToken: tokens.access_token, xRefreshToken: tokens.refresh_token ?? (preserveRefresh ? snapshot.xRefreshToken ?? null : null),
    xTokenExpiresAt: expiresAt, xScope: tokens.scope ?? snapshot.xScope ?? null, xTokenType: tokens.token_type,
  } : {
    ytAccessToken: tokens.access_token, ytRefreshToken: tokens.refresh_token ?? (preserveRefresh ? snapshot.ytRefreshToken ?? null : null),
    ytTokenExpiresAt: expiresAt, ytScope: tokens.scope ?? snapshot.ytScope ?? null, ytTokenType: tokens.token_type,
  };
}

export async function saveRefreshedTokens(provider: OAuthProvider, tokens: OAuthTokens, snapshot: AppSettings, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await prisma.$transaction(async (tx) => {
    signal?.throwIfAborted();
    const saved = await tx.settings.updateMany({ where: credentialWhere(provider, snapshot), data: tokenUpdate(provider, tokens, snapshot) });
    signal?.throwIfAborted();
    if (saved.count !== 1) throw new Error("OAuth connection changed during refresh. Retry with the current connection in Settings.");
  });
  return tokens.access_token;
}
