import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateEmbedding } from "@/lib/llm";
import { embeddingPendingWhere, parseEmbeddingJobConfig, runEmbeddingJob, submitEmbeddingJob } from "@/lib/embedding-job";
import { getSettings } from "@/lib/settings";
import { buildEmbeddingRunConfig } from "@/lib/run-config";
import { z } from "zod";
import { scheduleEmbeddingContinuation, workersEnabled } from "@/lib/work-continuation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const configSchema = z.object({ embeddingJob: z.unknown(), embeddingModel: z.string().nullable().optional(), embeddingBaseUrl: z.string().nullable().optional() });

export async function POST(request: Request) {
  const url = new URL(request.url);
  const limitValue = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(200, Math.floor(limitValue))) : 100;
  const sourceParam = url.searchParams.get("source");
  const source = sourceParam === "x" || sourceParam === "yt" ? sourceParam : null;
  let runId = url.searchParams.get("runId");
  if (!runId) {
    const settings = await getSettings();
    const submitted = await submitEmbeddingJob(prisma, { source, limit, includeUnverified: url.searchParams.get("rebuild") === "unverified", config: buildEmbeddingRunConfig(settings) });
    if (submitted.kind === "empty") return NextResponse.json({ ok: true, updated: 0, failed: 0, remaining: 0, source: source ?? "all", message: "No bookmarks need embedding sync." });
    if (submitted.kind === "conflict") return NextResponse.json({ ok: false, busy: true, runId: submitted.runId, error: submitted.error }, { status: 409 });
    runId = submitted.runId;
  }
  const run = await prisma.operationRun.findUnique({ where: { id: runId } });
  if (!run || run.type !== "embedding_sync") return NextResponse.json({ ok: false, error: "Embedding operation run not found.", runId }, { status: 404 });
  if (sourceParam && (run.source === "system" ? null : run.source) !== source) return NextResponse.json({ ok: false, runId, error: "This run belongs to a different source." }, { status: 409 });
  const parsed = configSchema.safeParse(parseEmbeddingJobConfig(run.configJson));
  if (!parsed.success || !parsed.data.embeddingJob) return NextResponse.json({ ok: false, runId, error: "This older run has no resumable checkpoint. Stop it and start a new sync." }, { status: 409 });
  const expected = parsed.data;
  async function configMatches() {
    const current = buildEmbeddingRunConfig(await getSettings());
    return current.embeddingModel === expected.embeddingModel && current.embeddingBaseUrl === expected.embeddingBaseUrl;
  }
  if ((run.status === "queued" || run.status === "running") && !await configMatches()) return NextResponse.json({ ok: false, runId, error: "Embedding configuration changed. Restore the run settings or stop this run and start a new sync." }, { status: 409 });
  const outcome = await runEmbeddingJob(prisma, { runId, model: expected.embeddingModel, generate: async (text) => {
    if (!await configMatches()) throw new Error("Embedding configuration changed during this run.");
    const vector = await generateEmbedding(text);
    if (!await configMatches()) throw new Error("Embedding configuration changed during this run.");
    return vector;
  } });
  const remaining = await prisma.bookmark.count({ where: embeddingPendingWhere(outcome.source) });
  const body = { updated: outcome.updated, failed: outcome.failed, skipped: outcome.skipped, remaining, source: outcome.source ?? "all", runId };
  if (outcome.kind === "busy") return NextResponse.json({ ok: false, ...body, busy: true, error: "Embedding sync is already running. Resume this runId after its lease expires." }, { status: 409 });
  if (outcome.kind === "stopped") return NextResponse.json({ ok: false, ...body, stopped: true, error: "This operation was stopped." }, { status: 409 });
  const allFailed = outcome.failed > 0 && outcome.updated === 0;
  const continuedByServer = outcome.kind === "finished"
    && !allFailed
    && remaining > 0
    && outcome.updated + outcome.skipped > 0
    && workersEnabled()
    && scheduleEmbeddingContinuation(url.origin, url.search);
  return NextResponse.json({ ok: !allFailed, ...body, continuedByServer, ...(outcome.error ? { error: outcome.error } : {}) }, { status: allFailed ? 502 : 200 });
}
