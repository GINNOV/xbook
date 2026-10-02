// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { prisma } from "@/lib/db";
import { createOAuthUrl, oauthCallback, OAUTH_SESSION_TTL_MS } from "@/lib/oauth-flow";
import { getAuthContext as xAuth } from "@/lib/x";
import { getAuthContext as ytAuth } from "@/lib/youtube";
import { getSettings } from "@/lib/settings";
import { POST as saveSettings } from "@/app/api/settings/route";
import { POST as generateUrl } from "@/app/api/youtube/oauth/url/route";
import type { OAuthProvider } from "@/lib/oauth-tokens";

const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client"); const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = fs.mkdtempSync(path.join(os.tmpdir(), "xbook-oauth-"));
  const databasePath = path.join(fixture.directory, "test.db"); const db = new Database(databasePath);
  const migrations = path.join(process.cwd(), "prisma/migrations");
  for (const name of fs.readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) db.exec(fs.readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  db.close(); return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) }) };
});
const origin = "http://localhost:3100";
const valid = { access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600, token_type: "Bearer", scope: "read" };
const request = (provider: OAuthProvider, state: string, signal?: AbortSignal, params = "code=fixture") => new Request(`${origin}/api/${provider === "yt" ? "youtube" : "x"}/oauth/callback?state=${encodeURIComponent(state)}&${params}`, { signal });
async function pending(provider: OAuthProvider) { return (await createOAuthUrl(provider, origin, await getSettings())).searchParams.get("state")!; }
async function credentials(provider: OAuthProvider) { const settings = await getSettings(); return provider === "x" ? [settings.xAccessToken, settings.xRefreshToken, settings.xUserId] : [settings.ytAccessToken, settings.ytRefreshToken]; }
async function disconnect(provider: OAuthProvider) {
  return saveSettings(new Request(`${origin}/api/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(provider === "x" ? { xAccessToken: "", xRefreshToken: "" } : { ytAccessToken: "", ytRefreshToken: "" }) }));
}
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await prisma.oAuthSession.deleteMany(); await prisma.settings.deleteMany();
  await prisma.settings.create({ data: { id: "default", xClientId: "x-client", xClientSecret: "x-secret", xApiBase: "https://api.x.com/2", xAccessToken: "old-access", xRefreshToken: "old-refresh", xUserId: "old-user", xTokenExpiresAt: new Date(Date.now() - 1000),
    ytClientId: "yt-client", ytClientSecret: "yt-secret", ytAccessToken: "old-access", ytRefreshToken: "old-refresh", ytTokenExpiresAt: new Date(Date.now() - 1000) } });
});
afterAll(async () => { vi.unstubAllGlobals(); await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });

for (const provider of ["x", "yt"] as const) {
  describe(`${provider} OAuth`, () => {
    it("rejects missing, foreign and expired states without a provider call", async () => {
      const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
      const state = await pending(provider);
      await prisma.oAuthSession.update({ where: { state }, data: { createdAt: new Date(Date.now() - OAUTH_SESSION_TTL_MS - 1) } });
      expect((await oauthCallback(provider, request(provider, state))).status).toBe(400);
      expect((await oauthCallback(provider, request(provider, `${provider === "x" ? "yt" : "x"}:not-a-state`))).status).toBe(400);
      expect((await oauthCallback(provider, request(provider, ""))).status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled(); expect((await credentials(provider))[0]).toBe("old-access");
    });
    it("provider denial consumes valid state and preserves credentials without leaking provider error", async () => {
      const state = await pending(provider); vi.stubGlobal("fetch", vi.fn());
      const response = await oauthCallback(provider, request(provider, state, undefined, "error=secret-provider-payload"));
      expect(response.status).toBe(307); expect(response.headers.get("location")).not.toContain("secret-provider-payload");
      expect(await prisma.oAuthSession.findUnique({ where: { state } })).toBeNull(); expect((await credentials(provider))[0]).toBe("old-access");
    });
    it.each([{ refresh_token: "untrusted" }, { ...valid, expires_in: -1 }, { ...valid, token_type: "MAC" }])("malformed callback tokens preserve credentials (%j)", async (payload) => {
      const state = await pending(provider); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      const response = await oauthCallback(provider, request(provider, state));
      expect(response.status).toBe(400); expect((await credentials(provider)).slice(0, 2)).toEqual(["old-access", "old-refresh"]);
    });
    it("commits valid tokens and consumes state once", async () => {
      const state = await pending(provider); const fetcher = vi.fn().mockImplementation(async (url) => String(url).endsWith("users/me") ? Response.json({ data: { id: "new-user" } }) : Response.json(valid)); vi.stubGlobal("fetch", fetcher);
      expect((await oauthCallback(provider, request(provider, state))).status).toBe(307);
      expect((await credentials(provider)).slice(0, 2)).toEqual(["new-access", "rotated-refresh"]);
      if (provider === "x") expect((await credentials(provider))[2]).toBe("new-user");
      const calls = fetcher.mock.calls.length; expect((await oauthCallback(provider, request(provider, state))).status).toBe(400); expect(fetcher.mock.calls).toHaveLength(calls);
    });
    it("does not let a concurrent replay delete the owner's claimed session", async () => {
      const state = await pending(provider);
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => {
        if (String(url).endsWith("users/me")) return Response.json({ data: { id: "new-user" } });
        expect((await oauthCallback(provider, request(provider, state))).status).toBe(400);
        expect(await prisma.oAuthSession.findUnique({ where: { state } })).not.toBeNull();
        return Response.json(valid);
      }));
      expect((await oauthCallback(provider, request(provider, state))).status).toBe(307);
    });
    it.each([false, true])("disconnect cancels claimed callback even with initially-null credentials=%s", async (empty) => {
      if (empty) await prisma.settings.update({ where: { id: "default" }, data: provider === "x" ? { xAccessToken: null, xRefreshToken: null } : { ytAccessToken: null, ytRefreshToken: null } });
      const state = await pending(provider);
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => {
        if (String(url).endsWith("users/me")) return Response.json({ data: { id: "new-user" } });
        expect((await disconnect(provider)).status).toBe(200); return Response.json(valid);
      }));
      expect((await oauthCallback(provider, request(provider, state))).status).toBe(400);
      expect((await credentials(provider)).slice(0, 2)).toEqual([null, null]);
    });
    it("aborted callback cannot commit even when provider ignores cancellation", async () => {
      const state = await pending(provider); const controller = new AbortController();
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { controller.abort(); return Response.json(valid); }));
      expect((await oauthCallback(provider, request(provider, state, controller.signal))).status).toBe(400);
      expect((await credentials(provider))[0]).toBe("old-access");
    });
    it("changed client configuration rejects pending sign-in before exchange", async () => {
      const state = await pending(provider); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
      await prisma.settings.update({ where: { id: "default" }, data: provider === "x" ? { xClientSecret: "changed" } : { ytClientSecret: "changed" } });
      expect((await oauthCallback(provider, request(provider, state))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
    });
    it("refresh stores rotation while preserving optional old scope", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(valid)));
      const auth = provider === "x" ? await xAuth() : await ytAuth();
      expect(auth).toMatchObject(provider === "x" ? { token: "new-access" } : { accessToken: "new-access" });
      expect((await credentials(provider)).slice(0, 2)).toEqual(["new-access", "rotated-refresh"]);
    });
    it("refresh without rotation preserves old refresh token", async () => {
      const payload = { access_token: valid.access_token, expires_in: valid.expires_in, token_type: valid.token_type, scope: valid.scope };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
      await (provider === "x" ? xAuth() : ytAuth());
      expect((await credentials(provider)).slice(0, 2)).toEqual(["new-access", "old-refresh"]);
    });
    it.each([400, 500])("refresh HTTP%s preserves credentials with concrete recovery and redacts body", async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant", secret: "secret-value" }, { status })));
      await expect(provider === "x" ? xAuth() : ytAuth()).rejects.toThrow(/Reconnect.*retry/);
      expect((await credentials(provider)).slice(0, 2)).toEqual(["old-access", "old-refresh"]);
    });
    it("malformed refresh cannot overwrite stored credentials", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ refresh_token: "bad" })));
      await expect(provider === "x" ? xAuth() : ytAuth()).rejects.toThrow("invalid tokens");
      expect((await credentials(provider)).slice(0, 2)).toEqual(["old-access", "old-refresh"]);
    });
    it("expired token without refresh rejects before a provider request", async () => {
      await prisma.settings.update({ where: { id: "default" }, data: provider === "x" ? { xRefreshToken: null } : { ytRefreshToken: null } });
      const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
      await expect(provider === "x" ? xAuth() : ytAuth()).rejects.toThrow("expired"); expect(fetcher).not.toHaveBeenCalled();
    });
    it("disconnect during refresh prevents credentials resurrecting", async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { await disconnect(provider); return Response.json(valid); }));
      await expect(provider === "x" ? xAuth() : ytAuth()).rejects.toThrow("changed during refresh");
      expect((await credentials(provider)).slice(0, 2)).toEqual([null, null]);
    });
    it("abort during refresh prevents later commit", async () => {
      const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => { controller.abort(); return Response.json(valid); }));
      await expect(provider === "x" ? xAuth(controller.signal) : ytAuth(controller.signal)).rejects.toThrow();
      expect((await credentials(provider))[0]).toBe("old-access");
    });
  });
}
it("missing X access token never sends Bearer null to users/me", async () => {
  await prisma.settings.update({ where: { id: "default" }, data: { xAccessToken: null, xRefreshToken: null, xTokenExpiresAt: null, xUserId: null } });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await expect(xAuth()).rejects.toThrow("requires an OAuth"); expect(fetcher).not.toHaveBeenCalled();
});
it("unsaved draft URL configuration rejects instead of generating an unusable callback", async () => {
  const response = await generateUrl(new Request(`${origin}/api/youtube/oauth/url`, { method: "POST", body: JSON.stringify({ ytClientId: "unsaved-client" }) }));
  expect(response.status).toBe(400); expect(await prisma.oAuthSession.count()).toBe(0);
});
it("token body overflow cannot alter credentials", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("a".repeat(65537))));
  await expect(ytAuth()).rejects.toThrow("too large"); expect((await credentials("yt"))[0]).toBe("old-access");
});

it("session expires during exchange without committing returned tokens", async () => {
  const state = await pending("yt");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
    await prisma.oAuthSession.update({ where: { state }, data: { createdAt: new Date(Date.now() - OAUTH_SESSION_TTL_MS - 1) } });
    return Response.json(valid);
  }));
  expect((await oauthCallback("yt", request("yt", state))).status).toBe(400);
  expect((await credentials("yt"))[0]).toBe("old-access");
});
it("pending sessions bind client configuration without storing secrets", async () => {
  const state = await pending("yt");
  const session = await prisma.oAuthSession.findUniqueOrThrow({ where: { state } });
  expect(session.codeVerifier).not.toContain("yt-secret");
  expect(session.codeVerifier).not.toContain("old-refresh");
});
it("cancellation during an unfinished response body returns without committing", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(stream) {
    stream.enqueue(new TextEncoder().encode('{"access_token":"partial"'));
    setTimeout(() => controller.abort(), 10);
  } }))));
  await expect(ytAuth(controller.signal)).rejects.toThrow();
  expect((await credentials("yt"))[0]).toBe("old-access");
});
it("real HTTP exchange and account lookup commit matching X identity with bounded token transport", async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? ""); res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url?.endsWith("users/me") ? { data: { id: "real-http-user" } } : valid));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture server address");
  try {
    await prisma.settings.update({ where: { id: "default" }, data: { xApiBase: `http://127.0.0.1:${address.port}/2` } });
    const state = await pending("x");
    expect((await oauthCallback("x", request("x", state))).status).toBe(307);
    expect(await credentials("x")).toEqual(["new-access", "rotated-refresh", "real-http-user"]);
    expect(requests).toEqual(["/2/oauth2/token", "/2/users/me"]);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
it("token HTTP redirect is rejected without following a second origin or altering credentials", async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => { requests.push(req.url ?? ""); res.statusCode = 302; res.setHeader("Location", "/secret-target"); res.end(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
  try {
    await prisma.settings.update({ where: { id: "default" }, data: { xApiBase: `http://127.0.0.1:${address.port}/2` } });
    await expect(xAuth()).rejects.toThrow(); expect(requests).toEqual(["/2/oauth2/token"]);
    expect((await credentials("x")).slice(0, 2)).toEqual(["old-access", "old-refresh"]);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
