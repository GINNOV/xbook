import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { captureLlmConnection, getEffectiveEmbeddingIdentity } from "./llm";
import { initialImportState } from "./import-job-contract";
import { jobCounts, operationRequestHash, readOperationJob, submitOperationJob } from "./operation-job";
import { wakeOperationWorker } from "./operation-worker";

const querySchema = z.object({ source: z.enum(["x", "yt"]).default("x"), folderId: z.string().min(1).optional(), all: z.enum(["true", "false"]).default("false"), pipeline: z.enum(["true", "false"]).default("false") });
export async function importOperationPost(request: Request, folders = false) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  const query = parsed.data;
  if (folders && !query.folderId && query.all !== "true") return NextResponse.json({ ok: false, error: "Select a folder or all folders." }, { status: 400 });
  if (query.folderId && !(query.source === "x" ? /^\d+$/.test(query.folderId) : /^yt:pl:[A-Za-z0-9_-]+$/.test(query.folderId))) return NextResponse.json({ ok: false, error: "Folder does not match selected source." }, { status: 400 });
  const spec = { kind: "import", folders, ...query };
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey) {
    const existing = await prisma.operationRun.findUnique({ where: { idempotencyKey } });
    if (existing) {
      let hash = readOperationJob(existing)?.requestHash;
      try { hash ??= z.object({ requestHash: z.string() }).parse(JSON.parse(existing.configJson ?? "{}")).requestHash; } catch { /* Older run has no reusable request fingerprint. */ }
      if (hash !== operationRequestHash(spec)) return NextResponse.json({ ok: false, error: "Idempotency key belongs to another request.", runId: existing.id }, { status: 409 });
      return response(existing.id);
    }
  }
  const active = await prisma.operationRun.findFirst({ where: { status: { in: ["queued", "running", "paused"] } } });
  if (active) return readOperationJob(active)?.requestHash === operationRequestHash(spec) ? response(active.id) : NextResponse.json({ ok: false, busy: true, runId: active.id, error: "Another operation owns the library. Finish or stop it first." }, { status: 409 });
  const settings = await getSettings();
  const selected = query.folderId ? await prisma.bookmarkFolder.findUnique({ where: { id: query.folderId } }) : null;
  if (query.folderId && !selected) return NextResponse.json({ ok: false, error: "Folder not found. Sync folder names first." }, { status: 404 });
  const state = initialImportState({ source: query.source, allFolders: folders, pipeline: query.pipeline === "true", cap: Math.max(0, (query.source === "yt" ? settings.ytMonthlyCap : settings.monthlyCap) ?? 100),
    provider: query.source === "x" ? { userId: settings.xUserId ?? process.env.X_USER_ID, endpoint: settings.xApiBase ?? process.env.X_API_BASE ?? "https://api.x.com/2" } : { accountFingerprint: `client:${operationRequestHash([settings.ytClientId ?? process.env.YT_CLIENT_ID?.trim() ?? ""])}` }, ...(selected ? { folder: { id: selected.id, name: selected.name ?? selected.id } } : {}) });
  let frozen: Record<string, unknown> = { concurrency: 1 };
  try { if (state.pipeline) frozen = { ...frozen, concurrency: z.number().int().min(1).max(32).parse(settings.llmConcurrency ?? 1), batchSize: z.number().int().min(1).max(10000).parse(settings.enrichBatchSize ?? 50), chat: await captureLlmConnection(), embedding: await getEffectiveEmbeddingIdentity() }; }
  catch (error) {
    const message = error instanceof Error ? error.message : "Model configuration unavailable";
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
      const previous = idempotencyKey ? await tx.operationRun.findUnique({ where: { idempotencyKey } }) : null;
      if (previous) {
        const previousHash = readOperationJob(previous)?.requestHash ?? z.object({ requestHash: z.string() }).parse(JSON.parse(previous.configJson ?? "{}")).requestHash;
        return { run: previous, conflict: previousHash !== operationRequestHash(spec) };
      }
      const owner = await tx.operationRun.findFirst({ where: { status: { in: ["queued", "running", "paused"] } } });
      if (owner) return { run: owner, conflict: true };
      return { run: await tx.operationRun.create({ data: { type: "import_pipeline", source: query.source, status: "failed", finishedAt: new Date(), notes: message, configJson: JSON.stringify({ requestHash: operationRequestHash(spec), repairAction: "/settings?tab=ai" }), idempotencyKey } }), conflict: false };
    });
    if (result.conflict) return NextResponse.json({ ok: false, busy: true, runId: result.run.id, error: "Another operation or request owns this submission." }, { status: 409 });
    return response(result.run.id);
  }
  const submitted = await submitOperationJob(prisma, { kind: "import", type: state.pipeline ? "import_pipeline" : folders ? query.source === "yt" ? "youtube_playlist_import" : "x_folder_import" : query.source === "yt" ? "youtube_sync" : "x_sync",
    scope: { source: query.source, folderId: query.folderId ?? null, replaceEdited: false }, settings: frozen, ids: [selected ? `folder:${selected.id}:0` : "discover:0"], importState: state, idempotencyKey, request: spec, config: { source: query.source, pipeline: state.pipeline, cap: state.cap } });
  if (submitted.kind === "conflict") return NextResponse.json({ ok: false, busy: true, runId: submitted.run?.id, error: submitted.error }, { status: 409 });
  if (!submitted.run) throw new Error("Import submission has no durable run");
  wakeOperationWorker(); return response(submitted.run.id);
}
async function response(runId: string) {
  const run = await prisma.operationRun.findUniqueOrThrow({ where: { id: runId } });
  const job = readOperationJob(run);
  return NextResponse.json({ ok: run.status !== "failed", runId, operationId: runId, source: run.source, status: run.status, ...(job ? jobCounts(job) : {}), ...(job?.import ?? {}), error: job?.error ?? run.notes, repairAction: job?.repairAction ?? (run.status === "failed" ? "/settings?tab=ai" : null) }, { status: run.status === "failed" ? 502 : run.status === "queued" || run.status === "running" ? 202 : 200 });
}
