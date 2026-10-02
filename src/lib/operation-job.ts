import { createHash, randomUUID } from "node:crypto";
import type { OperationRun, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { terminalRunStatuses } from "./run-outcome";

export const operationJobSchema = z.object({
  version: z.literal(1),
  kind: z.enum(["enrich", "embedding"]),
  requestHash: z.string(),
  scope: z.object({ source: z.enum(["x", "yt"]).nullable(), folderId: z.string().nullable(), replaceEdited: z.boolean() }),
  settings: z.record(z.string(), z.unknown()),
  items: z.array(z.object({ id: z.string(), status: z.enum(["pending", "updated", "failed", "skipped"]), attempts: z.number().int().nonnegative(), retryAt: z.number().nonnegative(), error: z.string().nullable() })),
  maxAttempts: z.number().int().min(1).max(5),
  preflightAttempts: z.number().int().nonnegative().default(0),
  preflightRetryAt: z.number().nonnegative().default(0),
  preflightError: z.string().nullable().default(null),
  error: z.string().nullable(),
  repairAction: z.string().nullable(),
});
export type OperationJob = z.infer<typeof operationJobSchema>;
export function readOperationJob(run: Pick<OperationRun, "jobJson">) {
  try { return operationJobSchema.parse(JSON.parse(run.jobJson ?? "null")); } catch { return null; }
}
export function jobCounts(job: OperationJob) {
  const updated = job.items.filter((item) => item.status === "updated").length;
  const failed = job.items.filter((item) => item.status === "failed").length;
  const skipped = job.items.filter((item) => item.status === "skipped").length;
  return { processed: updated + failed + skipped, updated, failed, skipped, remaining: job.items.filter((item) => item.status === "pending").length };
}
export type JobAdapter = {
  preflight?: (job: OperationJob, signal: AbortSignal) => Promise<void>;
  execute: (id: string, job: OperationJob, signal: AbortSignal, runId: string, persistPreparation?: (write: (tx: Prisma.TransactionClient) => Promise<void>) => Promise<boolean>) => Promise<(tx: Prisma.TransactionClient) => Promise<"updated" | "skipped">>;
};
export function jobError(error: unknown) {
  const message = error instanceof Error ? error.message : "Operation failed";
  const configuration = /missing|not found|ECONNREFUSED|Connection refused|not currently available|unauthorized|401|403|configuration changed/i.test(message);
  const transient = !configuration && /429|503|502|timeout|timed out|ECONNRESET|socket|temporarily|rate limit/i.test(message);
  return { message, configuration, transient };
}
export function operationRequestHash(request: unknown) { return createHash("sha256").update(JSON.stringify(request)).digest("hex"); }

async function sqliteWrite<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await write(); }
    catch (error) {
      if (attempt >= 3 || !(error instanceof Error) || !/database is locked|SQLITE_BUSY/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

export async function submitOperationJob(db: PrismaClient, input: {
  kind: OperationJob["kind"]; type: string; scope: OperationJob["scope"]; settings: OperationJob["settings"]; ids: string[];
  idempotencyKey?: string | null; config?: object; maxAttempts?: number; request?: object;
}) {
  const requestHash = operationRequestHash(input.request ?? [input.kind, input.type, input.scope, input.settings, input.config]);
  return sqliteWrite(() => db.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
    if (input.idempotencyKey) {
      const previous = await tx.operationRun.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previous) return readOperationJob(previous)?.requestHash === requestHash
        ? { kind: "ready", run: previous } : { kind: "conflict", run: previous, error: "Idempotency key belongs to a different request." };
    }
    const active = await tx.operationRun.findFirst({ where: { status: { in: ["queued", "running", "paused"] } }, orderBy: { startedAt: "asc" } });
    if (active) return readOperationJob(active)?.requestHash === requestHash
      ? { kind: "ready", run: active } : { kind: "conflict", run: active, error: "Another operation owns the library. Finish or stop it first." };
    if (!input.ids.length) return { kind: "empty" };
    const job: OperationJob = { version: 1, kind: input.kind, requestHash, scope: input.scope, settings: input.settings,
      items: [...new Set(input.ids)].map((id) => ({ id, status: "pending", attempts: 0, retryAt: 0, error: null })), maxAttempts: input.maxAttempts ?? 3, preflightAttempts: 0, preflightRetryAt: 0, preflightError: null, error: null, repairAction: null };
    const run = await tx.operationRun.create({ data: { type: input.type, source: input.scope.source, status: "queued", total: job.items.length,
      jobJson: JSON.stringify(job), configJson: JSON.stringify(input.config ?? {}), idempotencyKey: input.idempotencyKey ?? null } });
    return { kind: "ready", run };
  }));
}

export async function runOperationJob(db: PrismaClient, input: {
  runId: string; adapter: JobAdapter; leaseMs?: number; renewLease?: boolean; retryDelayMs?: number; controllers?: Map<string, AbortController>;
}) {
  const leaseMs = input.leaseMs ?? 30_000;
  const owner = randomUUID();
  const controller = new AbortController();
  let run = await db.operationRun.findUniqueOrThrow({ where: { id: input.runId } });
  let job = readOperationJob(run);
  if (!job) throw new Error("This run has no durable checkpoint. Start a new operation.");
  if (terminalRunStatuses.includes(run.status) || run.status === "paused" || job.preflightRetryAt > Date.now()) return run;
  const claim = await db.operationRun.updateMany({ where: { id: run.id, status: { in: ["queued", "running"] }, cancelRequestedAt: null,
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] }, data: { status: "running", leaseOwner: owner, leaseUntil: new Date(Date.now() + leaseMs), revision: { increment: 1 } } });
  if (!claim.count) return db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
  run = await db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
  const revision = run.revision;
  const fence = () => ({ id: run.id, status: "running", leaseOwner: owner, revision, cancelRequestedAt: null, leaseUntil: { gt: new Date() } });
  input.controllers?.set(run.id, controller);
  let renewing: Promise<void> | null = null;
  async function renew() {
    const renewed = await db.operationRun.updateMany({ where: fence(), data: { leaseUntil: new Date(Date.now() + leaseMs) } });
    if (!renewed.count) controller.abort();
  }
  const timer = input.renewLease === false ? null : setInterval(() => {
    if (!renewing) renewing = renew().catch(() => controller.abort()).finally(() => { renewing = null; });
  }, Math.min(1000, Math.max(10, Math.floor(leaseMs / 3))));
  try {
    try {
      if (jobCounts(job).remaining) await input.adapter.preflight?.(job, controller.signal);
      job.preflightError = null; job.preflightRetryAt = 0;
    }
    catch (error) {
      const cause = jobError(error);
      job.preflightAttempts++; job.preflightError = cause.message;
      const retry = cause.transient && job.preflightAttempts < job.maxAttempts;
      job.preflightRetryAt = retry ? Date.now() + (input.retryDelayMs ?? 1500) * job.preflightAttempts : 0;
      job.error = retry ? null : cause.message; job.repairAction = retry ? null : "/settings?tab=ai";
      await db.operationRun.updateMany({ where: fence(), data: { status: retry ? "queued" : "failed", notes: cause.message, jobJson: JSON.stringify(job), finishedAt: retry ? null : new Date(), leaseOwner: null, leaseUntil: null } });
      return db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
    }
    async function processItem(item: OperationJob["items"][number]) {
      if (!job || item.status !== "pending" || item.retryAt > Date.now() || controller.signal.aborted) return;
      await renew();
      if (controller.signal.aborted) return;
      let commit: Awaited<ReturnType<JobAdapter["execute"]>> | null = null;
      let failure: ReturnType<typeof jobError> | null = null;
      try { commit = await input.adapter.execute(item.id, job, controller.signal, run.id, async (write) => db.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
        if (controller.signal.aborted || !(await tx.operationRun.updateMany({ where: fence(), data: { leaseUntil: new Date(Date.now() + leaseMs) } })).count) return false;
        await write(tx); return true;
      })); }
      catch (error) { failure = jobError(error); }
      if (renewing) await renewing;
      const committed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
        if (controller.signal.aborted || !(await tx.operationRun.updateMany({ where: fence(), data: { leaseUntil: new Date(Date.now() + leaseMs) } })).count) return false;
        const current = await tx.operationRun.findUniqueOrThrow({ where: { id: run.id } });
        const next = readOperationJob(current);
        if (!next) throw new Error("Invalid operation checkpoint");
        const checkpoint = next.items.find((candidate) => candidate.id === item.id);
        if (!checkpoint || checkpoint.status !== "pending") return false;
        checkpoint.attempts++;
        if (commit) {
          await tx.$executeRawUnsafe("SAVEPOINT operation_item");
          try {
            checkpoint.status = await commit(tx);
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT operation_item");
          } catch (error) {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT operation_item");
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT operation_item");
            failure = jobError(error);
          }
        }
        if (failure) {
          checkpoint.error = failure.message;
          if (failure.transient && checkpoint.attempts < next.maxAttempts) checkpoint.retryAt = Date.now() + (input.retryDelayMs ?? 1500) * checkpoint.attempts;
          else checkpoint.status = "failed";
          if (next.kind === "enrich" && checkpoint.status === "failed") await tx.bookmark.updateMany({ where: { id: item.id }, data: { enrichmentError: failure.message, enrichmentFailures: { increment: 1 } } });
          if (failure.configuration) { next.error = failure.message; next.repairAction = "/settings?tab=ai"; }
        }
        const counts = jobCounts(next);
        await tx.operationRun.update({ where: { id: run.id }, data: { jobJson: JSON.stringify(next), processed: counts.processed, updated: counts.updated, failed: counts.failed, skipped: counts.skipped } });
        if (failure || checkpoint.status === "skipped") await tx.processingEvent.create({ data: { runId: run.id, bookmarkId: await tx.bookmark.count({ where: { id: item.id } }) ? item.id : null,
          type: "bookmark", status: checkpoint.status === "pending" ? "retrying" : checkpoint.status, message: failure?.message ?? "Current edits preserved or item no longer available." } });
        job = next;
        return true;
      });
      if (!committed) controller.abort();
    }
    const concurrency = z.number().int().min(1).max(32).catch(1).parse(job.settings.concurrency);
    const pendingItems = job.items.filter((item) => item.status === "pending" && item.retryAt <= Date.now());
    for (let offset = 0; offset < pendingItems.length && !controller.signal.aborted && !job.error; offset += concurrency) {
      await Promise.all(pendingItems.slice(offset, offset + concurrency).map(processItem));
    }
    const counts = jobCounts(job);
    const status = job.error ? (counts.updated ? "paused" : "failed") : counts.remaining ? "queued" : counts.failed ? (counts.updated ? "partial" : "failed") : "completed";
    job.error ??= status === "failed" ? `All ${counts.failed} ${job.kind === "embedding" ? "embedding" : "enrichment"} attempts failed.` : null;
    await db.operationRun.updateMany({ where: fence(), data: { status, notes: job.error, jobJson: JSON.stringify(job),
      leaseOwner: null, leaseUntil: null, finishedAt: terminalRunStatuses.includes(status) ? new Date() : null } });
    return db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
  } finally {
    if (timer) clearInterval(timer);
    if (renewing) await renewing;
    if (input.controllers?.get(run.id) === controller) input.controllers.delete(run.id);
  }
}

export async function stopOperationJob(db: PrismaClient, runId: string, controllers?: Map<string, AbortController>) {
  await db.operationRun.updateMany({ where: { id: runId, status: { in: ["queued", "running", "paused"] } }, data: {
    status: "stopped", cancelRequestedAt: new Date(), finishedAt: new Date(), leaseOwner: null, leaseUntil: null, revision: { increment: 1 },
  } });
  controllers?.get(runId)?.abort();
  return db.operationRun.findUnique({ where: { id: runId } });
}
export class OperationConflictError extends Error {
  constructor(message: string, readonly runId: string) { super(message); this.name = "OperationConflictError"; }
}
export async function resumeOperationJob(db: PrismaClient, runId: string) {
  return sqliteWrite(() => db.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
    const run = await tx.operationRun.findUniqueOrThrow({ where: { id: runId } });
    const job = readOperationJob(run);
    if (!job) throw new OperationConflictError("This older operation cannot resume. Start a new operation.", runId);
    if (!["stopped", "paused", "failed", "partial"].includes(run.status)) return run;
    const other = await tx.operationRun.findFirst({ where: { id: { not: runId }, status: { in: ["queued", "running", "paused"] } } });
    if (other) throw new OperationConflictError("Another operation owns the library. Finish or stop it before resuming this run.", other.id);
    job.error = null; job.repairAction = null; job.preflightAttempts = 0; job.preflightRetryAt = 0; job.preflightError = null;
    for (const item of job.items) if (item.status === "failed") { item.status = "pending"; item.retryAt = 0; item.attempts = 0; item.error = null; }
    const counts = jobCounts(job);
    await tx.operationRun.updateMany({ where: { id: runId, status: run.status, leaseOwner: null }, data: {
      processed: counts.processed, updated: counts.updated, failed: counts.failed, skipped: counts.skipped,
      status: "queued", cancelRequestedAt: null, finishedAt: null, jobJson: JSON.stringify(job), revision: { increment: 1 },
    } });
    return tx.operationRun.findUniqueOrThrow({ where: { id: runId } });
  }));
}
