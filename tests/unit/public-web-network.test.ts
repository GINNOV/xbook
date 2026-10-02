// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type RequestOptions, type IncomingMessage } from "node:http";
import { fetchPublicWeb } from "@/lib/public-web";
const fixture = vi.hoisted(() => ({ port: 0, addresses: [{ address: "8.8.8.8", family: 4 }], pinned: "", requests: 0, stalledDns: false }));
vi.mock("node:dns/promises", () => ({ lookup: async () => fixture.stalledDns ? new Promise(() => {}) : fixture.addresses }));
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, request: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    fixture.requests++;
    options.lookup?.(url.hostname, { family: 0, hints: 0, all: false }, (_error, address) => { fixture.pinned = typeof address === "string" ? address : address[0]?.address ?? ""; });
    // Replace only the socket destination with the controlled loopback provider.
    return actual.request(new URL(`http://127.0.0.1:${fixture.port}${url.pathname}`), { ...options, lookup: undefined }, callback);
  } };
});
let server: Server;
beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/plain");
    if (request.url === "/big") response.end("x".repeat(4096));
    else if (request.url === "/stall") { response.writeHead(200); response.flushHeaders(); }
    else response.end("Controlled body");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture listener"); fixture.port = address.port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { fixture.requests = 0; fixture.pinned = ""; fixture.addresses = [{ address: "8.8.8.8", family: 4 }]; fixture.stalledDns = false; });
describe("public web transport with a real bounded HTTP body", () => {
  it("pins the validated DNS address instead of resolving again in the socket", async () => {
    expect((await fetchPublicWeb("http://example.com/body")).text).toBe("Controlled body");
    expect(fixture.pinned).toBe("8.8.8.8"); expect(fixture.requests).toBe(1);
  });
  it("rejects mixed public/private DNS before opening any socket", async () => {
    fixture.addresses.push({ address: "127.0.0.1", family: 4 });
    await expect(fetchPublicWeb("http://example.com/body")).rejects.toThrow(/outside the public web/);
    expect(fixture.requests).toBe(0);
  });
  it("rejects a real streamed oversized body and aborts a stalled body after headers", async () => {
    await expect(fetchPublicWeb("http://example.com/big", { byteLimit: 1024 })).rejects.toThrow(/byte budget/);
    await expect(fetchPublicWeb("http://example.com/stall", { timeoutMs: 30 })).rejects.toThrow();
  });
  it("bounds stalled DNS resolution before opening any socket", async () => {
    fixture.stalledDns = true;
    await expect(fetchPublicWeb("http://example.com/body", { timeoutMs: 30 })).rejects.toThrow();
    expect(fixture.requests).toBe(0);
  });
});
