import { describe, expect, it } from "vitest";
import { resolveLoopbackRedirectUri, youtubeCallbackUri } from "@/lib/oauth-redirect";

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
