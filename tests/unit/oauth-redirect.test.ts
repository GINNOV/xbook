import { describe, expect, it } from "vitest";
import {
  requestPublicOrigin,
  resolveLoopbackRedirectUri,
  youtubeCallbackUri,
} from "@/lib/oauth-redirect";

function requestFrom(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("resolveLoopbackRedirectUri", () => {
  it("keeps a matching localhost callback", () => {
    expect(
      resolveLoopbackRedirectUri(
        "http://localhost:3000/api/oauth/youtube/callback",
        undefined,
        "http://localhost:3000",
      ),
    ).toBe("http://localhost:3000/api/oauth/youtube/callback");
  });

  it("rewrites a dead localhost port to the live origin", () => {
    expect(
      resolveLoopbackRedirectUri(
        "http://localhost:4010/api/oauth/youtube/callback",
        undefined,
        "http://localhost:3000",
      ),
    ).toBe("http://localhost:3000/api/oauth/youtube/callback");
  });

  it("rewrites 127.0.0.1 on another port", () => {
    expect(
      resolveLoopbackRedirectUri(
        "http://127.0.0.1:4010/api/oauth/youtube/callback",
        null,
        "http://127.0.0.1:3000",
      ),
    ).toBe(youtubeCallbackUri("http://127.0.0.1:3000"));
  });

  it("does not rewrite a non-loopback redirect", () => {
    expect(
      resolveLoopbackRedirectUri(
        "https://example.com/api/oauth/youtube/callback",
        undefined,
        "http://localhost:3000",
      ),
    ).toBe("https://example.com/api/oauth/youtube/callback");
  });

  it("falls back to the live origin when nothing is stored", () => {
    expect(resolveLoopbackRedirectUri(null, "", "http://localhost:3000")).toBe(
      "http://localhost:3000/api/oauth/youtube/callback",
    );
  });
});

describe("requestPublicOrigin", () => {
  it("uses the Host header when the request URL is the bind address", () => {
    expect(
      requestPublicOrigin(
        requestFrom("http://0.0.0.0:3000/api/x/oauth/callback?code=1", {
          host: "192.168.1.20:3000",
        }),
      ),
    ).toBe("http://192.168.1.20:3000");
  });

  it("prefers x-forwarded-host and x-forwarded-proto", () => {
    expect(
      requestPublicOrigin(
        requestFrom("http://0.0.0.0:3000/api/x/oauth/callback", {
          host: "0.0.0.0:3000",
          "x-forwarded-host": "book.example, internal",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://book.example");
  });

  it("rewrites an unspecified host to localhost with the same port", () => {
    expect(
      requestPublicOrigin(
        requestFrom("http://0.0.0.0:3000/settings", { host: "0.0.0.0:3000" }),
      ),
    ).toBe("http://localhost:3000");
  });
});
