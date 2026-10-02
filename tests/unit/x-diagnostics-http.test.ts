import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/x/diagnostics/route";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSettings: mocks.settings }));
vi.mock("@/lib/x", () => ({ getAuthContext: mocks.auth }));
let server: Server;
let origin: string;
let mode: "ok" | "denied" | "oversized" | "chunked" | "malformed" | "headers-hang" | "body-hang";
let paths: string[];
const secret = "diagnostic-private-fixture-token";
const sourceText = "Private saved bookmark fixture content";
const request = (signal?: AbortSignal) => new Request("http://localhost/api/x/diagnostics", { signal });
beforeAll(async () => {
  server = createServer((incoming, response) => {
    paths.push(incoming.url ?? ""); incoming.resume();
    response.setHeader("Connection", "close");
    if (mode === "headers-hang") return;
    response.setHeader("Content-Type", "application/json");
    if (mode === "body-hang") { response.flushHeaders(); response.write('{"data":'); return; }
    if (mode === "denied") { response.statusCode = 401; response.end(JSON.stringify({ error: `${secret} ${sourceText}`, authorization: incoming.headers.authorization })); return; }
    if (mode === "oversized") { response.setHeader("Content-Length", "70000"); response.end("s".repeat(70000)); return; }
    if (mode === "chunked") { response.write("s".repeat(40000)); response.end("s".repeat(40000)); return; }
    if (mode === "malformed") { response.end(`invalid ${secret} ${sourceText}`); return; }
    response.end(JSON.stringify(incoming.url?.includes("/users/me") ? { data: { id: secret, name: sourceText, token: secret } } : { data: [{ id: "123", text: sourceText, token: secret }], includes: { authorization: incoming.headers.authorization } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No diagnostic fixture listener");
  origin = `http://127.0.0.1:${address.port}/2`;
});
beforeEach(() => {
  vi.clearAllMocks(); mode = "ok"; paths = [];
  mocks.settings.mockResolvedValue({ xApiBase: origin, xAccessToken: secret, xRefreshToken: "refresh-fixture", xBearerToken: null, xUserId: "123", xScope: secret, xTokenExpiresAt: new Date(Date.now() + 3600000) });
  mocks.auth.mockResolvedValue({ token: secret, userId: "123", apiBase: origin });
});
afterEach(() => { server.closeAllConnections(); });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
function expectSafe(text: string) {
  expect(text).not.toContain(secret); expect(text).not.toContain(sourceText);
  expect(text).not.toContain('"authorization"'); expect(text).not.toContain('"body"');
}

describe("safe X diagnostics over actual provider HTTP", () => {
  it("validates account and bookmark access without returning provider data, tokens, or scope", async () => {
    const response = await GET(request()); const text = await response.text(); const json = JSON.parse(text);
    expectSafe(text);
    expect(response.status).toBe(200); expect(json.ok).toBe(true);
    expect(json.probes).toMatchObject({ me: { status: 200, ok: true }, bookmarks: { status: 200, ok: true } });
    expect(json.summary).toMatchObject({ hasAccessToken: true, hasRefreshToken: true, hasUserId: true, apiBase: origin });
    expect(json.summary).not.toHaveProperty("userId"); expect(json.summary).not.toHaveProperty("scope");
    expect(paths).toEqual(["/2/users/me?user.fields=id", "/2/users/123/bookmarks?max_results=5"]);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("discards a denied provider's secret-echo body and gives a reconnect action", async () => {
    mode = "denied";
    const response = await GET(request()); const text = await response.text(); expectSafe(text);
    expect(JSON.parse(text)).toMatchObject({ ok: false, probes: { me: { status: 401, ok: false }, bookmarks: null } });
    expect(text).toContain("Reconnect in Settings"); expect(paths).toHaveLength(1);
  });
  it("rejects credential/query-bearing configured URLs before auth/provider work and masks the summary", async () => {
    mocks.settings.mockResolvedValue({ xApiBase: origin.replace("http://", `http://user:${secret}@`) + `?token=${secret}#fragment`, xAccessToken: secret });
    const response = await GET(request()); const text = await response.text(); expectSafe(text);
    expect(response.status).toBe(400); expect(text).toContain("without URL credentials");
    expect(JSON.parse(text).summary.apiBase).toBe(origin); expect(mocks.auth).not.toHaveBeenCalled(); expect(paths).toHaveLength(0);
  });
  it.each(["oversized", "chunked", "malformed"] as const)("bounds or rejects %s JSON without reading it into output", async (value) => {
    mode = value; const response = await GET(request()); const text = await response.text(); expectSafe(text);
    expect(JSON.parse(text).probes.me).toMatchObject({ status: 200, ok: false });
    expect(text).toContain("invalid or oversized"); expect(paths).toHaveLength(1);
  });
  it("keeps auth/expiry errors generic even if their cause contains tokens", async () => {
    mocks.auth.mockRejectedValue(new Error(`expired ${secret} ${sourceText}`));
    const response = await GET(request()); const text = await response.text(); expectSafe(text);
    expect(response.status).toBe(401); expect(text).toContain("Reconnect in Settings"); expect(paths).toHaveLength(0);
  });
  it.each(["headers-hang", "body-hang"] as const)("enforces a real deadline on %s", async (value) => {
    mode = value; const started = Date.now(); const response = await GET(request()); const text = await response.text(); expectSafe(text);
    expect(response.status).toBe(504); expect(text).toContain("timed out"); expect(Date.now() - started).toBeLessThan(6500);
    expect(mocks.auth.mock.calls[0][0].aborted).toBe(true);
  }, 8000);
  it("cancels an in-flight response body promptly without another request", async () => {
    mode = "body-hang"; const controller = new AbortController();
    const pending = GET(request(controller.signal));
    await vi.waitFor(() => expect(paths).toHaveLength(1));
    controller.abort(); const response = await pending; const text = await response.text(); expectSafe(text);
    expect(response.status).toBe(499); expect(text).toContain("cancelled"); expect(paths).toHaveLength(1);
    expect(mocks.auth.mock.calls[0][0].aborted).toBe(true);
  });
});
