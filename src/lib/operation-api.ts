import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "./db";
import { pendingEnrichmentWhere } from "./bookmarks";
import { getIndexHealth } from "./index-health";
import { captureLlmConnection, getEffectiveEmbeddingIdentity } from "./llm";
import { getSettings } from "./settings";
import { buildEmbeddingRunConfig, buildEnrichmentRunConfig } from "./run-config";
import { OperationConflictError, operationRequestHash, jobCounts, readOperationJob, resumeOperationJob, submitOperationJob } from "./operation-job";
import { operationSettingsSchema } from "./operation-adapters";
import { wakeOperationWorker } from "./operation-worker";

const querySchema = z.object({
  source: z.enum(["x", "yt"]).nullable().default(null), folderId: z.string().trim().min(1).nullable().default(null),
  bookmarkId: z.string().min(1).nullable().default(null), runId: z.string().min(1).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(10000).optional(), concurrency: z.coerce.number().int().min(1).max(32).optional(),
  full: z.enum(["true", "false"]).default("false"), reprocess: z.enum(["true", "false"]).default("false"),
  replaceEdited: z.enum(["true", "false"]).default("false"), rebuild: z.enum(["true", "false"]).default("false"), resume: z.enum(["true", "false"]).default("false"),
});
export async function operationPost(request: Request, kind: "enrich" | "embedding", single = false) {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  const query = parsed.data;
  if (single && !query.bookmarkId) return NextResponse.json({ ok: false, error: "Missing bookmarkId" }, { status: 400 });
  const requestSpec = { kind, single, ...query, runId: null, resume: "false" };
  const requestHash = operationRequestHash(requestSpec);
  const idempotencyKey = request.headers.get("Idempotency-Key");
  let runId = query.runId;
  if (!runId && idempotencyKey) {
    const previous = await prisma.operationRun.findUnique({ where: { idempotencyKey } });
    if (previous) {
      let hash = readOperationJob(previous)?.requestHash;
      try { hash ??= z.object({ requestHash: z.string() }).parse(JSON.parse(previous.configJson ?? "{}")).requestHash; } catch { /* Earlier run without request fingerprint. */ }
      if (hash !== requestHash) return NextResponse.json({ ok: false, runId: previous.id, error: "Idempotency key belongs to a different request." }, { status: 409 });
      runId = previous.id;
    }
  }
  if (!runId) {
    const settings = await getSettings();
    const singleBookmark = single ? await prisma.bookmark.findUnique({ where: { id: query.bookmarkId ?? "" } }) : null;
    if (single && !singleBookmark) return NextResponse.json({ ok: false, error: "Bookmark not found" }, { status: 404 });
    const submissionSource = singleBookmark ? singleBookmark.source === "yt" ? "yt" : "x" : query.source;
    const limit = query.limit ?? (kind === "embedding" ? 100 : settings.enrichBatchSize ?? 50);
    const concurrency = query.concurrency ?? settings.llmConcurrency ?? 1;
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) return NextResponse.json({ ok: false, error: "Invalid batch size or concurrency. Correct AI settings." }, { status: 400 });
    let embedding: Awaited<ReturnType<typeof getEffectiveEmbeddingIdentity>>;
    let chat: Awaited<ReturnType<typeof captureLlmConnection>> | undefined;
    try { embedding = await getEffectiveEmbeddingIdentity(); chat = kind === "enrich" ? await captureLlmConnection() : undefined; }
    catch (error) {
      const message = error instanceof Error ? error.message : "Model configuration unavailable";
      const failedRun = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
        const existing = idempotencyKey ? await tx.operationRun.findUnique({ where: { idempotencyKey } }) : null;
        if (existing) return existing;
        return tx.operationRun.create({ data: { type: kind === "embedding" ? "embedding_sync" : single ? "single_reprocess" : "enrichment_batch", source: submissionSource,
          status: "failed", notes: message, finishedAt: new Date(), idempotencyKey, configJson: JSON.stringify({ requestHash, repairAction: "/settings?tab=ai" }) } });
      });
      return NextResponse.json({ ok: false, runId: failedRun.id, status: "failed", source: submissionSource ?? "all", processed: 0, updated: 0, failed: 0, skipped: 0, remaining: 0, error: message, repairAction: "/settings?tab=ai" }, { status: 502 });
    }
    let ids: string[];
    const source = submissionSource;
    if (single) {
      if (!singleBookmark) throw new Error("Missing selected bookmark");
      ids = [singleBookmark.id];
    } else if (kind === "embedding") {
      const health = await getIndexHealth(prisma, embedding, source);
      const rows = await prisma.bookmark.findMany({ where: query.rebuild === "true" ? { ...(source ? { source } : {}), AND: [{ summary: { not: null } }, { NOT: { summary: "" } }] } : { id: { in: health.rebuildIds } },
        orderBy: [{ importedAt: "desc" }, { id: "asc" }], select: { id: true } });
      ids = rows.map(({ id }) => id);
    } else {
      ids = (await prisma.bookmark.findMany({ where: { ...(query.reprocess === "true" ? {} : pendingEnrichmentWhere()), ...(source ? { source } : {}),
        ...(query.folderId ? { folderId: query.folderId } : {}), ...(!(query.full === "true" || query.reprocess === "true") ? { enrichmentFailures: { lt: 3 } } : {}) },
        orderBy: [{ importedAt: "desc" }, { id: "asc" }], ...(query.full !== "true" ? { take: limit } : {}), select: { id: true } })).map(({ id }) => id);
    }
    const submitted = await submitOperationJob(prisma, { kind, type: kind === "embedding" ? "embedding_sync" : single ? "single_reprocess" : query.folderId ? "folder_enrichment" : query.full === "true" ? query.reprocess === "true" ? "enrichment_full_reprocess" : "enrichment_full" : "enrichment_batch",
      scope: { source, folderId: query.folderId, replaceEdited: query.replaceEdited === "true" },
      settings: { ...(chat ? { chat } : {}), embedding, concurrency, batchSize: limit }, ids,
      idempotencyKey, request: requestSpec,
      config: kind === "embedding" ? { ...buildEmbeddingRunConfig(settings), embeddingModel: embedding.model, embeddingBaseUrl: embedding.endpoint, baseUrl: embedding.endpoint } : { ...buildEnrichmentRunConfig(settings, { concurrency, batchSize: limit }), model: chat?.model, baseUrl: chat?.baseUrl } });
    if (submitted.kind === "empty") return NextResponse.json({ ok: true, updated: 0, failed: 0, remaining: 0, source: source ?? "all", message: kind === "embedding" ? "No bookmarks need embedding sync." : "No bookmarks need processing." });
    if (!submitted.run) throw new Error("Missing submitted run");
    if (submitted.kind === "conflict") return NextResponse.json({ ok: false, runId: submitted.run.id, busy: true, error: submitted.error }, { status: 409 });
    runId = submitted.run.id;
  }
  let run = await prisma.operationRun.findUnique({ where: { id: runId } });
  const job = run && readOperationJob(run);
  if (run?.status === "failed" && !job) return NextResponse.json({ ok: false, runId, status: "failed", source: run.source ?? "all", processed: run.processed, updated: run.updated, failed: run.failed, skipped: run.skipped, remaining: 0, error: run.notes, repairAction: "/settings?tab=ai" }, { status: 502 });
  if (!run || !job || job.kind !== kind) return NextResponse.json({ ok: false, runId, error: "Operation has no matching durable checkpoint. Start a new operation." }, { status: 409 });
  if (query.source && job.scope.source !== query.source || query.folderId && job.scope.folderId !== query.folderId || single && !job.items.some((item) => item.id === query.bookmarkId)) return NextResponse.json({ ok: false, runId, error: "This run belongs to a different scope." }, { status: 409 });
  if (query.resume === "true") {
    try { run = await resumeOperationJob(prisma, runId); }
    catch (error) {
      if (error instanceof OperationConflictError) return NextResponse.json({ ok: false, runId, conflictingRunId: error.runId, error: error.message }, { status: 409 });
      throw error;
    }
  }
  wakeOperationWorker();
  run = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  const current = readOperationJob(run);
  if (!current) throw new Error("Invalid job checkpoint");
  const counts = jobCounts(current);
  const remaining = kind === "embedding" ? (await getIndexHealth(prisma, operationSettingsSchema.parse(current.settings).embedding, current.scope.source)).rebuildIds.length : counts.remaining;
  const failed = run.status === "failed";
  const stopped = run.status === "stopped";
  const pending = run.status === "queued" || run.status === "running";
  const body = { ok: !failed && !stopped, runId, source: current.scope.source ?? "all", ...counts, remaining, status: run.status, partial: run.status === "partial", stopped,
    ...(current.error ? { error: current.error, repairAction: current.repairAction } : {}),
    ...(single && run.updated ? { bookmark: await prisma.bookmark.findUnique({ where: { id: query.bookmarkId ?? current.items[0]?.id } }) } : {}),
  };
  if (single && counts.skipped && !run.updated && !pending) return NextResponse.json({ ...body, ok: false, skipped: true, skippedCount: counts.skipped, error: "Bookmark edits preserved. Use explicit replacement to replace a human correction." }, { status: 409 });
  return NextResponse.json(body, { status: failed ? 502 : stopped ? 409 : pending ? 202 : 200 });
}
