// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { prisma } from "@/lib/db";
import { captureTranscriptJson, fetchYouTubeTranscriptCaptureFromUrl, fetchYouTubeTranscriptFromUrl, TRANSCRIPT_MAX_SECTIONS, TRANSCRIPT_SECTION_CHARACTERS } from "@/lib/youtubeTranscript";
import { ASK_TOTAL_EVIDENCE_CHARACTERS, formatEvidenceSection, readSourceEvidence, selectQuestionEvidence, transcriptSummaryText, withSourceEvidence } from "@/lib/source-evidence";
import { POST as enrichOne } from "@/app/api/enrich/one/route";
import { POST as enrichBulk } from "@/app/api/enrich/route";
import { POST as ask } from "@/app/api/bookmarks/ask/route";

const fixture = vi.hoisted(() => ({ directory: "", chat: vi.fn(), embedding: vi.fn(), models: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-evidence-test-"));
  const databasePath = join(fixture.directory, "fixture.db");
  const connection = new Database(databasePath);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    connection.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  connection.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath }) }) };
});
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: fixture.chat } };
    embeddings = { create: fixture.embedding };
    models = { list: fixture.models };
  },
}));

const tailFact = "The cobalt reactor calibration requires exactly 73 kelvin.";
const metadata = { playlistId: "research", playlistTitle: "Original playlist", item: { snippet: { title: "Original provider title" } } };
function longTranscript() {
  return { events: [
    ...Array.from({ length: 220 }, (_, index) => ({ tStartMs: index * 10000, dDurationMs: 10000, segs: [{ utf8: `Ordinary context ${index}. ${"Opening material without the answer. ".repeat(42)}` }] })),
    { tStartMs: 2200000, dDurationMs: 10000, segs: [{ utf8: tailFact }] },
  ] };
}
function providerResponses(transcript: unknown = longTranscript()) {
  const player = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?v=fixture" }] } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/watch?")) return new Response(`var ytInitialPlayerResponse = ${JSON.stringify(player)};`);
    expect(String(url)).toContain("fmt=json3");
    return Response.json(transcript);
  }));
}
async function seed(id = "video") {
  return prisma.bookmark.create({ data: {
    id, source: "yt", tweetUrl: "https://www.youtube.com/watch?v=fixture", text: "Title and provider description",
    rawJson: JSON.stringify(metadata),
  } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await prisma.processingEvent.deleteMany();
  await prisma.llmRequestLog.deleteMany();
  await prisma.operationRun.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.settings.create({ data: { id: "default", llmModel: "fixture-model", llmEmbeddingModel: "fixture-embedding" } });
  fixture.chat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ summary: "Generated summary", category: "Science", tags: ["reactor"] }) } }] });
  fixture.embedding.mockResolvedValue({ data: [{ embedding: [1, 0] }] });
  fixture.models.mockResolvedValue({ data: [{ id: "fixture-model" }] });
  providerResponses();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await prisma.$disconnect();
  rmSync(fixture.directory, { recursive: true, force: true });
});

describe("long source evidence", () => {
  it("retains bounded timestamped tail sections after 12000 characters and marks sampling partial", () => {
    const capture = captureTranscriptJson(longTranscript());
    expect(capture.status).toBe("partial");
    expect(capture.totalCharacters).toBeGreaterThan(12000);
    expect(capture.sections).toHaveLength(TRANSCRIPT_MAX_SECTIONS);
    expect(capture.storedCharacters).toBeLessThanOrEqual(TRANSCRIPT_MAX_SECTIONS * TRANSCRIPT_SECTION_CHARACTERS);
    expect(capture.sections.at(-1)?.text).toContain(tailFact);
    expect(capture.sections.at(-1)?.startSeconds).toBe(2190);
    expect(capture.sections.every((section) => section.text.length <= TRANSCRIPT_SECTION_CHARACTERS)).toBe(true);
    const summaryInput = transcriptSummaryText(capture);
    expect(summaryInput).toContain("PARTIAL TRANSCRIPT EXCERPTS");
    expect(summaryInput).toContain(tailFact);
    expect(summaryInput?.length).toBeLessThan(10000);
  });

  it("preserves provider metadata and separates capture state from generated summaries", () => {
    const capture = captureTranscriptJson(longTranscript());
    const saved = withSourceEvidence(JSON.stringify(metadata), capture);
    expect(JSON.parse(saved)).toMatchObject(metadata);
    expect(readSourceEvidence(saved)?.capture).toEqual(capture);
    const opaque = withSourceEvidence("original non-JSON bytes", capture);
    expect(JSON.parse(opaque).xbookOriginalRawJson).toBe("original non-JSON bytes");
  });

  it("selects the tail answer against the question within a small evidence budget", () => {
    const rawJson = withSourceEvidence(JSON.stringify(metadata), captureTranscriptJson(longTranscript()));
    const selected = selectQuestionEvidence(rawJson, "What cobalt reactor calibration temperature is required?", 800);
    expect(selected[0].text).toContain(tailFact);
    expect(selected[0].startSeconds).toBe(2190);
    expect(selected.map(formatEvidenceSection).join("\n").length).toBeLessThanOrEqual(800);
    expect(selectQuestionEvidence(rawJson, "reactor", NaN)).toEqual([]);
    expect(selectQuestionEvidence(rawJson, "reactor", -1)).toEqual([]);
  });

  it("focuses a truncated passage around the matched fact instead of its prefix", () => {
    const capture = captureTranscriptJson({ events: [{ tStartMs: 1000, segs: [{ utf8: `${"General words. ".repeat(90)} ${tailFact}` }] }] });
    const selected = selectQuestionEvidence(withSourceEvidence(null, capture), "cobalt reactor", 200);
    expect(selected[0].text).toContain(tailFact);
    expect(selected.map(formatEvidenceSection).join("\n").length).toBeLessThanOrEqual(200);
  });

  it("distinguishes missing, malformed partial, and complete capture", async () => {
    const complete = captureTranscriptJson({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Short speech" }] }] });
    expect(complete).toMatchObject({ status: "complete", reason: null, sections: [{ text: "Short speech", startSeconds: 1, endSeconds: 3 }] });
    expect(captureTranscriptJson({ events: [{ segs: [{ utf8: "valid" }] }, { segs: "invalid" }] }).status).toBe("partial");
    expect(captureTranscriptJson({ events: [] })).toMatchObject({ status: "missing", sections: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("No captions")));
    expect(await fetchYouTubeTranscriptCaptureFromUrl("https://youtube.com/watch?v=fixture")).toMatchObject({ status: "missing", sections: [] });
    expect(await fetchYouTubeTranscriptFromUrl("https://youtube.com/watch?v=fixture")).toBeNull();
  });

  it("preserves the string/null legacy transcript adapter", async () => {
    providerResponses({ events: [{ tStartMs: 0, segs: [{ utf8: "Short speech" }] }] });
    expect(await fetchYouTubeTranscriptFromUrl("https://youtu.be/fixture")).toBe("Short speech");
    providerResponses();
    expect((await fetchYouTubeTranscriptFromUrl("https://youtu.be/fixture"))?.length).toBeLessThanOrEqual(12000);
  });

  it("persists single enrichment capture separately and supplies the tail to the summarizer", async () => {
    await seed();
    const response = await enrichOne(new Request("http://localhost/api/enrich/one?bookmarkId=video", { method: "POST" }));
    expect(response.status).toBe(200);
    const saved = await prisma.bookmark.findUniqueOrThrow({ where: { id: "video" } });
    expect(saved.summary).toBe("Generated summary");
    expect(JSON.parse(saved.rawJson ?? "{}")).toMatchObject(metadata);
    expect(readSourceEvidence(saved.rawJson)?.capture.sections.at(-1)?.text).toContain(tailFact);
    expect(JSON.stringify(fixture.chat.mock.calls[0])).toContain(tailFact);
    expect(saved.embeddingContentHash).not.toBeNull();
  });

  it("uses the same evidence capture in bulk enrichment", async () => {
    await seed();
    const response = await enrichBulk(new Request("http://localhost/api/enrich?source=yt&limit=1", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 1 });
    const saved = await prisma.bookmark.findUniqueOrThrow({ where: { id: "video" } });
    expect(JSON.parse(saved.rawJson ?? "{}")).toMatchObject(metadata);
    expect(readSourceEvidence(saved.rawJson)?.capture.status).toBe("partial");
    expect(readSourceEvidence(saved.rawJson)?.capture.sections.at(-1)?.text).toContain(tailFact);
    expect(JSON.stringify(fixture.chat.mock.calls[0])).toContain(tailFact);
  });

  it("retains missing capture state when summaries fail", async () => {
    await seed();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("No captions")));
    await prisma.settings.update({ where: { id: "default" }, data: { llmModel: null } });
    vi.stubEnv("OPENAI_MODEL", "");
    const response = await enrichOne(new Request("http://localhost/api/enrich/one?bookmarkId=video", { method: "POST" }));
    expect(response.status).toBe(500);
    const saved = await prisma.bookmark.findUniqueOrThrow({ where: { id: "video" } });
    expect(saved.summary).toBeNull();
    expect(readSourceEvidence(saved.rawJson)?.capture).toMatchObject({ status: "missing", sections: [] });
    expect(JSON.parse(saved.rawJson ?? "{}")).toMatchObject(metadata);
  });

  it("sends question-relevant source excerpts through the actual Ask prompt and cited response", async () => {
    const capture = captureTranscriptJson(longTranscript());
    await prisma.bookmark.create({ data: {
      id: "video", source: "yt", tweetUrl: "https://youtube.com/watch?v=fixture", summary: "Generic summary with no answer",
      rawJson: withSourceEvidence(JSON.stringify(metadata), capture), embedding: Buffer.from(new Float32Array([1, 0]).buffer),
    } });
    fixture.chat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ answer: "73 kelvin", citations: [{ id: "video", reason: "Tail evidence" }] }) } }] });
    const response = await ask(new Request("http://localhost/api/bookmarks/ask", {
      method: "POST", body: JSON.stringify({ question: "What cobalt reactor calibration temperature is required?", source: "yt" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.citations[0]).toMatchObject({ id: "video", timestampSeconds: 2190, captureStatus: "partial" });
    expect(body.citations[0].excerpt).toContain(tailFact);
    expect(JSON.stringify(fixture.chat.mock.calls[0])).toContain(tailFact);
    expect(JSON.stringify(fixture.chat.mock.calls[0])).toContain("transcript_capture=partial");
    const used = body.matches.flatMap((match: { sourceEvidence: { text: string }[] }) => match.sourceEvidence).reduce((sum: number, section: { text: string }) => sum + section.text.length, 0);
    expect(used).toBeLessThanOrEqual(ASK_TOTAL_EVIDENCE_CHARACTERS);
  });
});
