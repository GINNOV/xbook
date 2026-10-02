import type { PrismaClient } from "@prisma/client";
import { parseEmbeddingJobConfig } from "./embedding-job";
import { prisma } from "./db";
import { enrichmentSignals } from "./signals";
import { operationAdapter } from "./operation-adapters";
import { readOperationJob, runOperationJob } from "./operation-job";

declare global { var xbookOperationWorker: { timer: ReturnType<typeof setInterval>; ticking: boolean } | undefined; }

export async function recoverLegacyEmbeddingJobs(db: PrismaClient = prisma) {
  const legacyEmbeddings = await db.operationRun.findMany({ where: { type: "embedding_sync", jobJson: null, status: { in: ["queued", "running"] } } });
  for (const run of legacyEmbeddings) {
    const config = parseEmbeddingJobConfig(run.configJson);
    if (!config) {
      await db.operationRun.updateMany({ where: { id: run.id, jobJson: null, configJson: run.configJson }, data: { status: "failed", finishedAt: new Date(), notes: "Interrupted older embedding run has no valid checkpoint. Start a new embedding sync." } });
      continue;
    }
    if (config.embeddingJob.leaseUntil > Date.now()) continue;
    const job = { version: 1, kind: "embedding", requestHash: run.id, scope: { source: run.source === "x" || run.source === "yt" ? run.source : null, folderId: null, replaceEdited: false },
      settings: { embedding: { model: typeof config.embeddingModel === "string" ? config.embeddingModel : "", endpoint: typeof config.embeddingBaseUrl === "string" ? config.embeddingBaseUrl : "http://localhost:1234/v1" } },
      items: config.embeddingJob.items.map((item) => ({ ...item, attempts: item.status === "pending" ? 0 : 1, retryAt: 0, error: null })), maxAttempts: 3, error: null, repairAction: null };
    await db.operationRun.updateMany({ where: { id: run.id, configJson: run.configJson, jobJson: null }, data: { status: "queued", jobJson: JSON.stringify(job), leaseOwner: null, leaseUntil: null } });
  }
}
export async function recoverLegacyOperations(db: PrismaClient = prisma) {
  await recoverLegacyEmbeddingJobs(db);
  // Older runs cannot prove item completion from their progress events.
  await db.operationRun.updateMany({ where: { jobJson: null, type: { not: "embedding_sync" }, status: { in: ["queued", "running"] } }, data: {
    status: "failed", finishedAt: new Date(), notes: "Interrupted older operation has no durable checkpoint. Start a new operation to continue.",
  } });
  await db.importRun.updateMany({ where: { finishedAt: null }, data: { finishedAt: new Date(), notes: "Interrupted older import. Start a new import to continue." } });
}
export async function processOperationQueue() {
  await recoverLegacyEmbeddingJobs();
  const runs = await prisma.operationRun.findMany({ where: { jobJson: { not: null }, status: { in: ["queued", "running"] },
    cancelRequestedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, orderBy: { startedAt: "asc" }, take: 10 });
  for (const run of runs) {
    const job = readOperationJob(run);
    if (!job) {
      await prisma.operationRun.updateMany({ where: { id: run.id, revision: run.revision }, data: { status: "failed", finishedAt: new Date(), notes: "Invalid durable checkpoint. Start a new operation." } });
      continue;
    }
    if (job.preflightRetryAt > Date.now()) continue;
    if (job.items.some((item) => item.status === "pending") && job.items.every((item) => item.status !== "pending" || item.retryAt > Date.now())) continue;
    try { await runOperationJob(prisma, { runId: run.id, adapter: operationAdapter(job), controllers: enrichmentSignals }); }
    catch (error) {
      await prisma.operationRun.updateMany({ where: { id: run.id, revision: run.revision, leaseOwner: null }, data: { status: "failed", finishedAt: new Date(), notes: error instanceof Error ? error.message : "Invalid job settings. Correct AI settings and restart." } });
    }
  }
}
export async function startOperationWorker() {
  if (global.xbookOperationWorker) return;
  const state = { timer: setInterval(() => { void tick(); }, 1000), ticking: false };
  global.xbookOperationWorker = state;
  state.timer.unref();
  async function tick() {
    if (state.ticking) return;
    state.ticking = true;
    try { await processOperationQueue(); } catch { /* Retry after database maintenance or provider interruption. */ } finally { state.ticking = false; }
  }
  try { await recoverLegacyOperations(); void tick(); }
  catch { /* Startup continues; durable jobs will retry through the guarded timer. */ }
}
export function wakeOperationWorker() {
  if (process.env.NODE_ENV === "test") return;
  void startOperationWorker();
}
