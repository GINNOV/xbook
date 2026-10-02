import { createHash } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { getSettings, type AppSettings } from "./settings";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "./pkce";
import { resolveLoopbackRedirectUri } from "./oauth-redirect";
import { credentialWhere, oauthJson, requestOAuthTokens, tokenUpdate, type OAuthProvider } from "./oauth-tokens";

export const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;
const sessionSchema = z.object({
  version: z.literal(1), provider: z.enum(["x", "yt"]), verifier: z.string().min(43).max(128),
  clientId: z.string().min(1), redirectUri: z.string().url(), apiBase: z.string().url(),
  configuration: z.string(), claimed: z.boolean().default(false),
});

function config(provider: OAuthProvider, settings: AppSettings, origin: string) {
  if (provider === "x") return {
    clientId: settings.xClientId ?? process.env.X_CLIENT_ID ?? "",
    clientSecret: settings.xClientSecret ?? process.env.X_CLIENT_SECRET,
    redirectUri: settings.xRedirectUri ?? process.env.X_REDIRECT_URI ?? `${origin}/api/x/oauth/callback`,
    apiBase: settings.xApiBase ?? process.env.X_API_BASE ?? "https://api.x.com/2",
  };
  return {
    clientId: settings.ytClientId ?? process.env.YT_CLIENT_ID ?? "",
    clientSecret: settings.ytClientSecret ?? process.env.YT_CLIENT_SECRET,
    redirectUri: resolveLoopbackRedirectUri(settings.ytRedirectUri, process.env.YT_REDIRECT_URI, origin),
    apiBase: "https://oauth2.googleapis.com",
  };
}

function configurationFingerprint(value: ReturnType<typeof config>) {
  // Compare secret changes without putting client secrets in the pending session.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function createOAuthUrl(provider: OAuthProvider, origin: string, settings: AppSettings) {
  const configuration = config(provider, settings, origin);
  if (!configuration.clientId || (provider === "yt" && !configuration.clientSecret)) throw new Error(`Missing ${provider === "yt" ? "YouTube client ID/client secret" : "X client ID"}. Save OAuth configuration in Settings before connecting.`);
  const state = `${provider}:${generateState()}`;
  const verifier = generateCodeVerifier();
  const now = new Date();
  await prisma.oAuthSession.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - OAUTH_SESSION_TTL_MS) } } });
  await prisma.oAuthSession.create({ data: { state, codeVerifier: JSON.stringify({ version: 1, provider, verifier,
    clientId: configuration.clientId, redirectUri: configuration.redirectUri, apiBase: configuration.apiBase,
    configuration: configurationFingerprint(configuration), claimed: false }) } });
  const url = new URL(provider === "x" ? "https://x.com/i/oauth2/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", configuration.redirectUri);
  url.searchParams.set("scope", provider === "x" ? "tweet.read users.read bookmark.read offline.access" : "https://www.googleapis.com/auth/youtube.readonly");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", generateCodeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (provider === "yt") { url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
  return url;
}

export async function oauthStart(provider: OAuthProvider, request: Request) {
  const origin = new URL(request.url).origin;
  try { return NextResponse.redirect(await createOAuthUrl(provider, origin, await getSettings())); }
  catch { const redirect = new URL("/settings", origin); redirect.searchParams.set("error", provider === "x" ? "missing_client_id" : "missing_yt_client_id"); return NextResponse.redirect(redirect); }
}

export async function oauthCallback(provider: OAuthProvider, request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const denied = url.searchParams.has("error");
  if (!state?.startsWith(`${provider}:`) || state.length > 100 || (!code && !denied) || (code?.length ?? 0) > 16384) return NextResponse.json({ ok: false, error: "Missing or invalid OAuth code/state. Start sign-in again in Settings." }, { status: 400 });
  let claimed: string | undefined;
  try {
    request.signal.throwIfAborted();
    const session = await prisma.oAuthSession.findUnique({ where: { state } });
    const cutoff = new Date(Date.now() - OAUTH_SESSION_TTL_MS);
    if (!session || session.createdAt < cutoff || session.createdAt.getTime() > Date.now()) {
      await prisma.oAuthSession.deleteMany({ where: { state } });
      throw new Error("OAuth sign-in expired or was cancelled. Start sign-in again in Settings.");
    }
    let raw: unknown;
    try { raw = JSON.parse(session.codeVerifier); } catch { throw new Error("Invalid OAuth session. Start sign-in again in Settings."); }
    const data = sessionSchema.parse(raw);
    if (data.provider !== provider || data.claimed) throw new Error("OAuth sign-in has already been used. Start sign-in again in Settings.");
    const claim = JSON.stringify({ ...data, claimed: true });
    const reserved = await prisma.oAuthSession.updateMany({ where: { state, codeVerifier: session.codeVerifier, createdAt: { gte: cutoff } }, data: { codeVerifier: claim } });
    if (reserved.count !== 1) throw new Error("OAuth sign-in changed or was cancelled. Start sign-in again in Settings.");
    claimed = claim;
    if (denied) {
      const redirect = new URL(provider === "x" ? "/settings" : "/oauth/done", url.origin);
      if (provider === "yt") redirect.searchParams.set("provider", "youtube");
      redirect.searchParams.set("error", "Sign-in cancelled. Existing connection was preserved.");
      return NextResponse.redirect(redirect);
    }
    const snapshot = await getSettings();
    const configuration = config(provider, snapshot, url.origin);
    if (configurationFingerprint(configuration) !== data.configuration) throw new Error("OAuth configuration changed. Save Settings and start sign-in again.");
    const body = new URLSearchParams({ grant_type: "authorization_code", code: code ?? "", client_id: data.clientId, redirect_uri: data.redirectUri, code_verifier: data.verifier });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (provider === "yt") body.set("client_secret", configuration.clientSecret ?? "");
    else if (configuration.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${data.clientId}:${configuration.clientSecret}`).toString("base64")}`;
    const tokenUrl = provider === "yt" ? `${data.apiBase}/token` : `${data.apiBase}/oauth2/token`;
    const tokens = await requestOAuthTokens(tokenUrl, { method: "POST", headers, body }, request.signal);
    let userId: string | undefined;
    if (provider === "x") {
      const account = z.object({ data: z.object({ id: z.string().min(1) }) }).safeParse(await oauthJson(`${data.apiBase}/users/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } }, request.signal));
      if (!account.success) throw new Error("X account lookup failed. Stored connection was preserved; retry sign-in.");
      userId = account.data.data.id;
    }
    request.signal.throwIfAborted();
    await prisma.$transaction(async (tx) => {
      // Reserve SQLite's writer lock before checking the session and credentials.
      await tx.$executeRawUnsafe("UPDATE OAuthSession SET createdAt=createdAt WHERE 0");
      request.signal.throwIfAborted();
      const consumed = await tx.oAuthSession.deleteMany({ where: { state, codeVerifier: claimed, createdAt: { gte: new Date(Date.now() - OAUTH_SESSION_TTL_MS) } } });
      if (consumed.count !== 1) throw new Error("OAuth sign-in expired or was disconnected. Start sign-in again in Settings.");
      const update = tokenUpdate(provider, tokens, snapshot, false);
      if (provider === "x") update.xUserId = userId;
      const saved = await tx.settings.updateMany({ where: credentialWhere(provider, snapshot), data: update });
      request.signal.throwIfAborted();
      if (saved.count !== 1) throw new Error("OAuth connection changed. Start sign-in again in Settings.");
    });
    const redirect = new URL(provider === "x" ? "/settings" : "/oauth/done", url.origin);
    redirect.searchParams.set(provider === "x" ? "oauth" : "provider", provider === "x" ? "success" : "youtube");
    return NextResponse.redirect(redirect);
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid OAuth session. Start sign-in again in Settings." : error instanceof Error ? error.message : "OAuth sign-in failed. Start sign-in again in Settings.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  } finally {
    // Only the callback which owns the claim may clean it up. Replays must not cancel its owner.
    if (claimed) await prisma.oAuthSession.deleteMany({ where: { state, codeVerifier: claimed } });
  }
}
