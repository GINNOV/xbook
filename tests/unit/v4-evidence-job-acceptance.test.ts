// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { indexedFixture } from "../fixtures/embedding";
import { prisma } from "@/lib/db";
import { captureTranscriptJson } from "@/lib/youtubeTranscript";
import { withSourceEvidence, selectQuestionEvidence, readSourceEvidence, formatEvidenceSection } from "@/lib/source-evidence";
import { POST as ask } from "@/app/api/bookmarks/ask/route";
import { runEmbeddingJob, submitEmbeddingJob } from "@/lib/embedding-job";
const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/db", async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { default: Database } = await import("better-sqlite3");
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  fixture.directory = mkdtempSync(join(tmpdir(), "xbook-v4-acceptance-"));
  const path = join(fixture.directory, "fixture.db");
  const connection = new Database(path);
  const migrations = join(process.cwd(), "prisma/migrations");
  for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
    connection.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  connection.close();
  return { prisma: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: path }) }) };
});
vi.mock("@/lib/llm", () => {
  const generateEmbedding = vi.fn().mockResolvedValue([1, 0]);
  return ({
    generateEmbeddingResult: async (text: string, signal?: AbortSignal) => ({
      vector: await generateEmbedding(text, signal),
      identity: { model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 },
    }),
    getEffectiveEmbeddingIdentity: async () => ({ model: "fixture-model", endpoint: "http://localhost:1234/v1", dimensions: 2 }),
 generateEmbedding, answerLibraryQuestion: vi.fn().mockImplementation(async ({ candidates }) => ({ answer: "Tail answer", citations: [{ id: candidates[0].id, reason: "Source passage" }] })) });
});
import { answerLibraryQuestion } from "@/lib/llm";
beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.processingEvent.deleteMany(); await prisma.llmRequestLog.deleteMany(); await prisma.operationRun.deleteMany(); await prisma.bookmark.deleteMany();
});
afterAll(async () => { await prisma.$disconnect(); rmSync(fixture.directory, { recursive: true, force: true }); });

describe("V6 independent evidence acceptance", () => {
  it("retrieves a tail fact from twelve long videos within the total prompt budget", async () => {
    const capture = captureTranscriptJson({ events: [
      ...Array.from({length: 100}, (_, i) => ({tStartMs:i*30000, dDurationMs:30000, segs:[{utf8: "General background. ".repeat(110)}]})),
      {tStartMs:3000000, dDurationMs:2000, segs:[{utf8:"Project xenolith uses the password lavender-seven."}]}
    ]});
    expect(capture.status).toBe("partial");
    const rawJson = withSourceEvidence(JSON.stringify({provider:"untouched"}), capture);
    expect(JSON.parse(rawJson).provider).toBe("untouched");
    const selected = selectQuestionEvidence(rawJson, "What password does project xenolith use?", 800);
    expect(selected[0].text).toContain("lavender-seven");
    expect(selected.map(formatEvidenceSection).join("\n").length).toBeLessThanOrEqual(800);
    await prisma.bookmark.createMany({data:Array.from({length:12}, (_,i)=>({id:`video-${i}`,source:"yt",tweetUrl:`https://youtube.com/watch?v=fixture${i}`,summary:"Generic",rawJson,embedding:Buffer.from(new Float32Array([1,0]).buffer)})).map(indexedFixture)});
    const response = await ask(new Request("http://localhost/api/bookmarks/ask", {method:"POST",body:JSON.stringify({source:"yt",question:"What password does project xenolith use?"})}));
    expect(response.status).toBe(200);
    const body = await response.json();
    const candidates = vi.mocked(answerLibraryQuestion).mock.calls[0][0].candidates;
    expect(candidates).toHaveLength(12);
    expect(candidates.every(c => c.sourceEvidence?.[0].text.includes("lavender-seven"))).toBe(true);
    expect(candidates.flatMap(c=>c.sourceEvidence??[]).map(formatEvidenceSection).join("\n").length).toBeLessThanOrEqual(9612);
    expect(body.citations[0].excerpt).toContain("lavender-seven");
    expect(body.citations[0].timestampSeconds).toBe(selected[0].startSeconds);
  });
  it("timestamps a citation using its quoted later passage rather than the first selected passage", async () => {
    const rawJson = withSourceEvidence(null, { status: "complete", reason: null, capturedAt: new Date().toISOString(), totalCharacters: 100, storedCharacters: 100,
      sections: [{ text: "Reactor calibration begins with careful controls.", startSeconds: 10, endSeconds: 20 },
        { text: "The final calibration measurement is 73 kelvin.", startSeconds: 120, endSeconds: 124 }] });
    await prisma.bookmark.create({ data: indexedFixture({ id: "later-passage", source: "yt", tweetUrl: "https://youtube.com/watch?v=fixture", summary: "Calibration", rawJson }) });
    vi.mocked(answerLibraryQuestion).mockResolvedValueOnce({ answer: "73 kelvin", citations: [{ id: "later-passage", reason: "Final measurement", quote: "final calibration measurement is 73 kelvin" }] });
    const response = await ask(new Request("http://localhost/api/bookmarks/ask", { method: "POST", body: JSON.stringify({ source: "yt", question: "What is the reactor calibration?" }) }));
    const candidates = vi.mocked(answerLibraryQuestion).mock.calls[0][0].candidates;
    expect(candidates[0].sourceEvidence?.[0].startSeconds).toBe(10);
    expect(await response.json()).toMatchObject({ citations: [{ id: "later-passage", timestampSeconds: 120, excerpt: "final calibration measurement is 73 kelvin" }] });
  });
  it("reports absent and malformed evidence without treating it as a complete capture", () => {
    expect(readSourceEvidence('{"xbookSourceEvidence":{"version":999}}')).toBeNull();
    const capture = captureTranscriptJson({events:[]});
    expect(capture.status).toBe("missing");
    expect(selectQuestionEvidence(withSourceEvidence(null,capture),"answer")).toEqual([]);
  });
});

describe("V5 independent checkpoint acceptance", () => {
  async function seed() {
    await prisma.bookmark.createMany({data:["a","b","c"].map(id=>({id,source:"x",tweetUrl:`https://x.com/${id}`,summary:id}))});
    const submitted=await submitEmbeddingJob(prisma,{source:"x",limit:3});
    if(submitted.kind!=="ready") throw new Error("Expected ready job");
    return submitted.runId;
  }
  it("rolls back both vector and checkpoint when checkpoint persistence fails", async () => {
    const runId=await seed();
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON OperationRun WHEN NEW.updated > OLD.updated BEGIN SELECT RAISE(ABORT, 'checkpoint rejected'); END`);
    try {
      await expect(runEmbeddingJob(prisma,{runId,generate:async()=>[1,0]})).rejects.toThrow();
      expect(await prisma.bookmark.count({where:{embedding:{not:null}}})).toBe(0);
      expect(await prisma.operationRun.findUnique({where:{id:runId}})).toMatchObject({processed:0,updated:0});
    } finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_checkpoint'); }
  });
  it("keeps a fixed item list and returns conflict for a different source", async () => {
    const runId=await seed();
    await prisma.bookmark.create({data:{id:"late",source:"x",tweetUrl:"https://x.com/late",summary:"late"}});
    expect(await submitEmbeddingJob(prisma,{source:"x",limit:200})).toEqual({kind:"ready",runId});
    expect(await submitEmbeddingJob(prisma,{source:"yt",limit:200})).toMatchObject({kind:"conflict",runId});
    expect(await runEmbeddingJob(prisma,{runId,generate:async()=>[1,0]})).toMatchObject({updated:3});
    expect((await prisma.bookmark.findUniqueOrThrow({where:{id:"late"}})).embedding).toBeNull();
  });
});
