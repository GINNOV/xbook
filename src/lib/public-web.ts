import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["198.51.100.0", 24], ["203.0.113.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] satisfies Array<[string, number]>) blocked.addSubnet(address, prefix, "ipv4");
blocked.addSubnet("2001:db8::", 32, "ipv6");
const globalV6 = new BlockList(); globalV6.addSubnet("2000::", 3, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
export function publicWebUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))
    || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || (isIP(host) && !isPublicAddress(host))) throw new Error("Only public HTTP(S) destinations without credentials are captured.");
  return url;
}
export type WebResponse = { status: number; headers: { location?: string; contentType?: string }; text: string };
export type WebTransport = (url: URL, options: { signal: AbortSignal; byteLimit: number }) => Promise<WebResponse>;

/** Resolve and pin a public address for each hop; never resolve again in the socket. */
export const publicWebTransport: WebTransport = async (url, options) => {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const resolution = lookup(host, { all: true, verbatim: true });
  const addresses = await new Promise<Awaited<typeof resolution>>((resolve, reject) => {
    const abort = () => reject(options.signal.reason);
    options.signal.addEventListener("abort", abort, { once: true });
    resolution.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", abort));
    if (options.signal.aborted) abort();
  });
  options.signal.throwIfAborted();
  if (!addresses.length || addresses.some((record) => !isPublicAddress(record.address))) throw new Error("Destination resolves outside the public web.");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      signal: options.signal,
      headers: { "User-Agent": "XBook/1.0", "Accept": "text/html, text/plain;q=0.9", "Accept-Encoding": "identity" },
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const headers = { location: response.headers.location, contentType: response.headers["content-type"] };
      if (status >= 300 && status < 400) { response.destroy(); resolve({ status, headers, text: "" }); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > options.byteLimit) { const error = new Error("Source response exceeds its byte budget."); reject(error); response.destroy(error); request.destroy(error); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, headers, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("Source response was interrupted.")));
    });
    request.on("error", reject); request.end();
  });
};
export async function fetchPublicWeb(value: string, options: { signal?: AbortSignal; byteLimit?: number; timeoutMs?: number; transport?: WebTransport } = {}) {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10_000), ...(options.signal ? [options.signal] : [])]);
  let url = publicWebUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const response = await (options.transport ?? publicWebTransport)(url, { signal, byteLimit: options.byteLimit ?? 2 * 1024 * 1024 });
    signal.throwIfAborted();
    if (response.status >= 300 && response.status < 400) {
      if (!response.headers.location) throw new Error("Source redirect has no destination.");
      url = publicWebUrl(new URL(response.headers.location, url).toString()); continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Source returned HTTP ${response.status}.`);
    return { ...response, url: url.toString() };
  }
  throw new Error("Source exceeded its redirect budget.");
}
