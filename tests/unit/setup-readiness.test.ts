import { describe, expect, it } from "vitest";
import { getSetupReadiness } from "@/lib/setup-readiness";

describe("getSetupReadiness", () => {
  it("blocks everything when settings are empty", () => {
    const r = getSetupReadiness("x", null);
    expect(r.sourceConnected).toBe(false);
    expect(r.chatModelSet).toBe(false);
    expect(r.embeddingModelSet).toBe(false);
    expect(r.canSync).toBe(false);
    expect(r.canProcessInbox).toBe(false);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.blockers.some((b) => b.includes("X OAuth"))).toBe(true);
  });

  it("allows sync when only OAuth is set", () => {
    const r = getSetupReadiness("x", {
      xAccessToken: "token",
      llmModel: null,
      llmEmbeddingModel: null,
    });
    expect(r.canSync).toBe(true);
    expect(r.canProcessInbox).toBe(false);
    expect(r.chatModelSet).toBe(false);
  });

  it("allows process inbox when OAuth + chat model are set", () => {
    const r = getSetupReadiness("yt", {
      ytAccessToken: "yt-token",
      llmModel: "gemma-4",
      llmEmbeddingModel: null,
    });
    expect(r.sourceConnected).toBe(true);
    expect(r.canProcessInbox).toBe(true);
    expect(r.embeddingModelSet).toBe(false);
    expect(r.blockers.some((b) => b.toLowerCase().includes("embedding"))).toBe(true);
  });

  it("is fully ready when connection and both models are set", () => {
    const r = getSetupReadiness("x", {
      xAccessToken: "token",
      llmModel: "chat",
      llmEmbeddingModel: "embed",
    });
    expect(r.canSync).toBe(true);
    expect(r.canProcessInbox).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("ignores whitespace-only tokens and models", () => {
    const r = getSetupReadiness("x", {
      xAccessToken: "   ",
      llmModel: "  ",
      llmEmbeddingModel: "\t",
    });
    expect(r.sourceConnected).toBe(false);
    expect(r.chatModelSet).toBe(false);
    expect(r.embeddingModelSet).toBe(false);
  });
});
