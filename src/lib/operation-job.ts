import { createHash, randomUUID } from "node:crypto";
import type { OperationRun, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { importJobStateSchema, type ImportJobState } from "./import-job-contract";
import { terminalRunStatuses } from "./run-outcome";

export const operationJobSchema = z.object({
  version: z.literal(1),
  kind: z.enum(["enrich", "embedding", "import"]),
  import: importJobStateSchema.nullable().optional(),
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
  if (job.kind === "import" && job.import) {
    const state = job.import;
    const updated = state.imported + state.refreshed + state.enriched + state.indexed;
    const failed = state.foldersFailed + state.stageFailed;
    const skipped = state.skipped + state.unavailable - state.unavailableStored;
    return { processed: updated + failed + skipped, updated, failed, skipped, remaining: job.items.filter((item) => item.status === "pending").length };
  }
  const updated = job.items.filter((item) => item.status === "updated").length;
  const failed = job.items.filter((item) => item.status === "failed").length;
  const skipped = job.items.filter((item) => item.status === "skipped").length;
  return { processed: updated + failed + skipped, updated, failed, skipped, remaining: job.items.filter((item) => item.status === "pending").length };
}
export type JobAdapter = {
  onFailure?: (tx: Prisma.TransactionClient, draft: OperationJob, id: string, message: string) => Promise<void>;
  preflight?: (job: OperationJob, signal: AbortSignal) => Promise<void>;
  execute: (id: string, job: OperationJob, signal: AbortSignal, runId: string, persistPreparation?: (write: (tx: Prisma.TransactionClient, draft: OperationJob) => Promise<void>) => Promise<boolean>) => Promise<(tx: Prisma.TransactionClient, draft: OperationJob) => Promise<"updated" | "skipped" | "pending">>;
};
export class OperationItemError extends Error {
  constructor(message: string, readonly classification: { configuration: boolean; transient: boolean }) { super(message); this.name = "OperationItemError"; }
}
export function jobError(error: unknown) {
  const message = error instanceof Error ? error.message : "Operation failed";
  if (error instanceof OperationItemError) return { message, ...error.classification };
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
  idempotencyKey?: string | null; config?: object; maxAttempts?: number; request?: object; importState?: ImportJobState;
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
    const job: OperationJob = { version: 1, kind: input.kind, import: input.importState ?? null, requestHash, scope: input.scope, settings: input.settings,
      items: [...new Set(input.ids)].map((id) => ({ id, status: "pending", attempts: 0, retryAt: 0, error: null })), maxAttempts: input.maxAttempts ?? 3, preflightAttempts: 0, preflightRetryAt: 0, preflightError: null, error: null, repairAction: null };
    const run = await tx.operationRun.create({ data: { type: input.type, source: input.scope.source, status: "queued", total: input.kind === "import" ? 0 : job.items.length,
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
      job.error = retry ? null : cause.message; job.repairAction = retry ? null : job.kind === "import" ? "/settings?tab=connections" : "/settings?tab=ai";
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
        const current = await tx.operationRun.findUniqueOrThrow({ where: { id: run.id } });
        const draft = readOperationJob(current);
        if (!draft) throw new Error("Invalid operation checkpoint");
        await write(tx, draft);
        await tx.operationRun.update({ where: { id: run.id }, data: { jobJson: JSON.stringify(draft) } });
        return true;
      })); }
      catch (error) { failure = jobError(error); }
      if (renewing) await renewing;
      const committed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
        if (controller.signal.aborted || !(await tx.operationRun.updateMany({ where: fence(), data: { leaseUntil: new Date(Date.now() + leaseMs) } })).count) return false;
        const current = await tx.operationRun.findUniqueOrThrow({ where: { id: run.id } });
        const next = readOperationJob(current);
        if (!next) throw new Error("Invalid operation checkpoint");
        let checkpoint = next.items.find((candidate) => candidate.id === item.id);
        if (!checkpoint || checkpoint.status !== "pending") return false;
        checkpoint.attempts++;
        if (commit) {
          await tx.$executeRawUnsafe("SAVEPOINT operation_item");
          try {
            const draft = structuredClone(next);
            const result = await commit(tx, draft);
            Object.assign(next, draft);
            checkpoint = next.items.find((candidate) => candidate.id === item.id)!;
            next.items.find((candidate) => candidate.id === item.id)!.status = result;
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
          if (checkpoint.status === "failed") await input.adapter.onFailure?.(tx, next, item.id, failure.message);
          if (failure.configuration) { next.error = failure.message; next.repairAction = next.kind === "import" && next.import?.phase !== "enrich" && next.import?.phase !== "embedding" ? "/settings?tab=connections" : "/settings?tab=ai"; }
        }
        const counts = jobCounts(next);
        await tx.operationRun.update({ where: { id: run.id }, data: { jobJson: JSON.stringify(next), processed: counts.processed, updated: counts.updated, failed: counts.failed, skipped: counts.skipped, ...(next.kind === "import" ? { total: counts.processed + (next.import?.pendingEntries ?? 0) + next.items.filter((candidate) => candidate.status === "pending" && /^(enrich|embedding):/.test(candidate.id)).length } : {}) } });
        if (failure || checkpoint.status === "skipped") await tx.processingEvent.create({ data: { runId: run.id, bookmarkId: await tx.bookmark.count({ where: { id: item.id } }) ? item.id : null,
          type: "bookmark", status: checkpoint.status === "pending" ? "retrying" : checkpoint.status, message: failure?.message ?? "Current edits preserved or item no longer available." } });
        job = next;
        return true;
      });
      if (!committed) controller.abort();
    }
    const importing = job.kind === "import" && job.import?.phase !== "enrich" && job.import?.phase !== "embedding";
    const concurrency = importing ? 1 : z.number().int().min(1).max(32).catch(1).parse(job.settings.concurrency);
    const batchSize = z.number().int().min(1).max(10000).catch(50).parse(job.settings.batchSize);
    const kind = job.kind; const phase = job.import?.phase;
    const pendingItems = job.items.filter((item) => item.status === "pending" && item.retryAt <= Date.now() && (kind !== "import" || (importing ? !/^(enrich|embedding):/.test(item.id) : item.id.startsWith(`${phase}:`)))).slice(0, job.kind === "import" ? importing ? 1 : batchSize : undefined);
    for (let offset = 0; offset < pendingItems.length && !controller.signal.aborted && !job.error; offset += concurrency) {
      await Promise.all(pendingItems.slice(offset, offset + concurrency).map(processItem));
    }
    const counts = jobCounts(job);
    const status = job.kind === "import" && job.import?.blockReason ? "paused" : job.error ? (counts.updated ? "paused" : "failed") : counts.remaining ? "queued" : counts.failed ? (counts.updated ? "partial" : "failed") : "completed";
    job.error ??= job.import?.blockReason ?? null;
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
    if (job.kind === "import" && job.import) {
      const settings = await tx.settings.findUnique({ where: { id: "default" } });
      job.import.cap = Math.max(0, (job.import.source === "yt" ? settings?.ytMonthlyCap : settings?.monthlyCap) ?? 0);
      job.import.capBlocked = false; job.import.blockReason = null;
      job.import.foldersFailed = 0; job.import.stageFailed = 0; job.import.folderErrors = [];
      for (const folder of job.import.folders) if (folder.status === "failed") folder.status = "pending";
    }
    job.error = null; job.repairAction = null; job.preflightAttempts = 0; job.preflightRetryAt = 0; job.preflightError = null;
    for (const item of job.items) if (item.status === "failed") { item.status = "pending"; item.retryAt = 0; item.attempts = 0; item.error = null; }
    if (job.kind === "import" && job.import) {
      const outstanding = job.items.filter((item) => item.status === "pending");
      job.import.phase = outstanding.some((item) => item.id.startsWith("discover:")) ? "discover" : outstanding.some((item) => !/^(enrich|embedding):/.test(item.id)) ? "import" : outstanding.some((item) => item.id.startsWith("enrich:")) ? "enrich" : outstanding.length ? "embedding" : "done";
    }
    const counts = jobCounts(job);
    await tx.operationRun.updateMany({ where: { id: runId, status: run.status, leaseOwner: null }, data: {
      processed: counts.processed, updated: counts.updated, failed: counts.failed, skipped: counts.skipped,
      status: "queued", cancelRequestedAt: null, finishedAt: null, jobJson: JSON.stringify(job), revision: { increment: 1 },
    } });
    return tx.operationRun.findUniqueOrThrow({ where: { id: runId } });
  }));
}
