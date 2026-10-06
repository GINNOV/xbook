import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { POST as ask } from "@/app/api/bookmarks/ask/route";
import { generateEmbeddingResult, summarizeBookmark, translateText } from "@/lib/llm";
import { embeddingContentHash } from "@/lib/embedding-index";
import { captureTranscriptJson } from "@/lib/youtubeTranscript";
import { withSourceEvidence } from "@/lib/source-evidence";

const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-live-acceptance-"));
  const databasePath = join(fixture.directory, "fixture.db");
  const db = new Database(databasePath);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) }) };
});

const settings = z.object({
  enabled: z.literal("1"),
  chatUrl: z.string().url(), chatModel: z.string().min(1),
  embeddingUrl: z.string().url(), embeddingModel: z.string().min(1),
}).parse({ enabled: process.env.XBOOK_LIVE_ACCEPTANCE, chatUrl: process.env.XBOOK_LIVE_CHAT_URL,
  chatModel: process.env.XBOOK_LIVE_CHAT_MODEL, embeddingUrl: process.env.XBOOK_LIVE_EMBEDDING_URL,
  embeddingModel: process.env.XBOOK_LIVE_EMBEDDING_MODEL });
const citationSchema = z.object({ id: z.string(), excerpt: z.string().nullable(), timestampSeconds: z.number().nullable(), captureStatus: z.string().nullable() });
const responseSchema = z.object({ ok: z.literal(true), answer: z.string(), citations: z.array(citationSchema), semanticError: z.string().nullable() });
const report: { model: string; embeddingModel: string; cases: Record<string, unknown> } = { model: settings.chatModel, embeddingModel: settings.embeddingModel, cases: {} };
const tailFact = "The amberlake emergency access code is lavender-seven.";
const capture = captureTranscriptJson({ events: [
  ...Array.from({ length: 100 }, (_, i) => ({ tStartMs: i * 30_000, dDurationMs: 30_000, segs: [{ utf8: "General introduction to the synthetic research process. ".repeat(30) }] })),
  { tStartMs: 3_000_000, dDurationMs: 2_000, segs: [{ utf8: tailFact }] },
] });
async function askQuestion(question: string) {
  const response = await ask(new Request("http://localhost/api/bookmarks/ask", { method: "POST", body: JSON.stringify({ source: "yt", question }) }));
  expect(response.status).toBe(200);
  return responseSchema.parse(await response.json());
}
async function seedTail() {
  const summary = "Synthetic research overview";
  const generated = await generateEmbeddingResult(summary);
  await prisma.bookmark.create({ data: { id: "live-tail", source: "yt", tweetUrl: "https://youtube.com/watch?v=synthetic-tail", summary,
    rawJson: withSourceEvidence(null, capture), embedding: Buffer.from(new Float32Array(generated.vector).buffer),
    embeddingModel: generated.identity.model, embeddingEndpoint: generated.identity.endpoint, embeddingDimensions: generated.identity.dimensions,
    embeddingIndexedAt: new Date(), embeddingContentHash: embeddingContentHash({ summary, category: null, tags: null }) } });
  return generated;
}
beforeAll(async () => {
  await prisma.settings.create({ data: { id: "default", llmBaseUrl: settings.chatUrl, llmModel: settings.chatModel,
    llmEmbeddingBaseUrl: settings.embeddingUrl, llmEmbeddingModel: settings.embeddingModel,
    llmApiKey: "synthetic-verification-placeholder", llmContextWindow: 8192, llmMaxTokens: 1200,
    llmResponseLimit: 1200, logLlmPayloads: false, targetLanguage: "Italian" } });
});
beforeEach(async () => { await prisma.llmRequestLog.deleteMany(); await prisma.bookmark.deleteMany(); });
afterAll(async () => {
  if (process.env.XBOOK_LIVE_REPORT) writeFileSync(process.env.XBOOK_LIVE_REPORT, JSON.stringify(report, null, 2) + "\n");
  await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true });
});

describe("approved live-model acceptance using synthetic data", () => {
  it("answers a retained tail fact through the actual Ask route, embeddings and timestamped source citations", async () => {
    const generated = await seedTail();
    expect(generated.vector).toHaveLength(768);
    expect(generated.vector.every(Number.isFinite)).toBe(true);
    expect(capture.status).toBe("partial");
    const answer = await askQuestion("What is the amberlake emergency access code?");
    report.cases.tail = { dimensions: generated.vector.length, ...answer };
    expect(answer.semanticError).toBeNull();
    expect(answer.answer).toMatch(/lavender-seven/i);
    expect(answer.citations.length).toBeGreaterThan(0);
    const tailSection = capture.sections.find((section) => section.text.includes(tailFact));
    expect(tailSection).toBeDefined();
    expect(answer.citations.every((c) => c.id === "live-tail" && c.excerpt?.includes("lavender-seven") && c.timestampSeconds === tailSection?.startSeconds)).toBe(true);
    expect(await prisma.llmRequestLog.count()).toBeGreaterThan(0);
  });
  it("declines an unsupported question despite retrieving real saved evidence", async () => {
    await seedTail();
    const answer = await askQuestion("What is the amberlake director's private birthday?");
    expect(answer.answer).toMatch(/insufficient evidence/i); expect(answer.citations).toEqual([]);
    expect(await prisma.llmRequestLog.count()).toBeGreaterThan(0);
    report.cases.unsupported = answer;
  });
  it("discloses description-only partial evidence and declines uncaptured video details", async () => {
    const text = "The harborstone video description announces a blue waterproof notebook. No demonstration transcript is available.";
    await prisma.bookmark.create({ data: { id: "live-description", source: "yt", tweetUrl: "https://youtube.com/watch?v=synthetic-description", summary: "Harborstone notebook", captureJson: JSON.stringify({ version: 2, method: "description", language: "en", sourceUrls: [], capture: { status: "partial", reason: "Only the video description was captured; the transcript is unavailable.", capturedAt: new Date().toISOString(), totalCharacters: text.length, storedCharacters: text.length, sections: [{ text, startSeconds: null, endSeconds: null }] } }) } });
    const answer = await askQuestion("What does the harborstone description announce, and is this based on the full video?");
    expect(answer.answer).toMatch(/blue/i); expect(answer.answer).toMatch(/description|partial|incomplete|limited|not.*full/i);
    expect(answer.citations).toMatchObject([{ id: "live-description", captureStatus: "partial", timestampSeconds: null }]);
    const missing = await askQuestion("What exact waterproof pressure did the harborstone video demonstration measure?");
    expect(missing.answer).toMatch(/insufficient evidence/i); expect(missing.citations).toEqual([]);
    report.cases.partial = { answer, missing };
  });
  it("keeps a long-source tail fact and capture limitations in the generated digest", async () => {
    const longText = "General background for a fictional research note. ".repeat(900) + tailFact;
    const digest = await summarizeBookmark({ text: "Amberlake emergency access research. Include the final confirmed access code and disclose partial-source limits.", sourceText: longText,
      sourceCapture: { method: "article", language: "en", status: "partial", reason: "Some source sections were unavailable." }, skipEmbedding: true });
    expect(digest.summary).toMatch(/lavender-seven/i); expect(digest.summary).toMatch(/partial|incomplete|unavailable|limited|missing/i);
    expect(await prisma.llmRequestLog.count()).toBeGreaterThan(1);
    report.cases.summary = { summary: digest.summary, category: digest.category, requests: await prisma.llmRequestLog.count() };
  });
  it("honors the documented target language in on-demand translation", async () => {
    const saved = await prisma.settings.findUniqueOrThrow({ where: { id: "default" } });
    const translation = await translateText({ text: "The backup completed successfully at 03:15.", targetLanguage: saved.targetLanguage });
    expect(translation).toMatch(/03:15/); expect(translation).toMatch(/completat|terminat|conclus/i);
    expect(translation).not.toMatch(/TEXT TO TRANSLATE|here is|translation:/i);
    expect(translation).not.toMatch(/^[{\[]|```/);
    report.cases.translation = { language: saved.targetLanguage, translation };
  });
});
