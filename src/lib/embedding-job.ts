import { getIndexHealth } from "./index-health";
import type { EmbeddingIdentity, GeneratedEmbedding } from "./embedding-vector";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, OperationRun } from "@prisma/client";
import { z } from "zod";
import { contentSnapshot, saveEmbeddingIfUnchanged } from "./embedding-index";

const jobSchema = z.object({
  version: z.literal(1),
  items: z.array(z.object({ id: z.string(), status: z.enum(["pending", "updated", "failed", "skipped"]) })),
  owner: z.string().nullable(),
  leaseUntil: z.number(),
  error: z.string().nullable(),
});
const configSchema = z.object({ embeddingJob: jobSchema }).passthrough();
type Job = z.infer<typeof jobSchema>;

function readConfig(run: OperationRun) {
  const config = parseEmbeddingJobConfig(run.configJson);
  if (!config) throw new Error("This older run has no resumable checkpoint. Stop it and start a new sync.");
  return config;
}
export function parseEmbeddingJobConfig(configJson: string | null) {
  try {
    const result = configSchema.safeParse(JSON.parse(configJson ?? "null"));
    return result.success ? result.data : null;
  } catch { return null; }
}
function counts(job: Job) {
  return {
    processed: job.items.filter((item) => item.status !== "pending").length,
    updated: job.items.filter((item) => item.status === "updated").length,
    failed: job.items.filter((item) => item.status === "failed").length,
    skipped: job.items.filter((item) => item.status === "skipped").length,
  };
}
export function embeddingPendingWhere(source?: string | null): Prisma.BookmarkWhereInput {
  return { ...(source ? { source } : {}), embedding: null, AND: [{ summary: { not: null } }, { NOT: { summary: "" } }] };
}

export async function submitEmbeddingJob(db: PrismaClient, input: {
  source: string | null; limit: number; config?: object; rebuild?: boolean; identity?: Pick<EmbeddingIdentity, "model" | "endpoint">;
}): Promise<{ kind: "empty" } | { kind: "ready"; runId: string } | { kind: "conflict"; runId: string; error: string }> {
  const identity = input.identity;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
    // Acquire SQLite's write lock before reading active runs. This no-op avoids
    // two independent processes both submitting a job from the same snapshot.
    await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
    const active = await tx.operationRun.findFirst({
      where: { type: "embedding_sync", status: { in: ["queued", "running"] } },
      orderBy: { startedAt: "asc" },
    });
    if (active) {
      if (!parseEmbeddingJobConfig(active.configJson)) return { kind: "conflict", runId: active.id, error: "An older embedding run has no resumable checkpoint. Stop that run before starting a new sync." };
      if ((active.source === "system" ? null : active.source) !== input.source) return { kind: "conflict", runId: active.id, error: "An embedding sync for a different source is active. Finish or stop that run first." };
      return { kind: "ready", runId: active.id };
    }
    const health = await getIndexHealth(tx, identity, input.source);
    const pending = await tx.bookmark.findMany({ where: input.rebuild ? { ...(input.source ? { source: input.source } : {}), AND: [{ summary: { not: null } }, { NOT: { summary: "" } }] } : { id: { in: health.rebuildIds } }, take: input.limit, orderBy: [{ importedAt: "desc" }, { id: "asc" }], select: { id: true } });
    if (!pending.length) return { kind: "empty" };
    const job: Job = { version: 1, items: pending.map(({ id }) => ({ id, status: "pending" })), owner: null, leaseUntil: 0, error: null };
    const run = await tx.operationRun.create({ data: {
      type: "embedding_sync", source: input.source ?? "system", status: "queued", total: pending.length,
      notes: `Syncing embeddings for ${pending.length} bookmarks.`,
      configJson: JSON.stringify({ ...input.config, embeddingModel: identity?.model ?? null, embeddingBaseUrl: identity?.endpoint ?? null, rebuild: input.rebuild ?? false, embeddingJob: job }),
    } });
    return { kind: "ready", runId: run.id };
      });
    } catch (cause) {
      if (attempt >= 3 || !(cause instanceof Error) || !/database is locked|SQLITE_BUSY/i.test(cause.message)) throw cause;
      await new Promise<void>((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

export async function runEmbeddingJob(db: PrismaClient, input: {
  runId: string; generate: (text: string) => Promise<number[] | GeneratedEmbedding>; leaseMs?: number; renewLease?: boolean;
}) {
  const leaseMs = input.leaseMs ?? 30_000;
  const owner = randomUUID();
  let run = await db.operationRun.findUniqueOrThrow({ where: { id: input.runId } });
  if (run.type !== "embedding_sync") throw new Error("Operation run is not an embedding sync job.");
  let config = readConfig(run);
  const result = (kind: "busy" | "stopped" | "finished") => ({ kind, runId: run.id, source: run.source === "system" ? null : run.source, ...counts(config.embeddingJob), error: config.embeddingJob.error });
  if (run.status === "stopped") return result("stopped");
  if (run.status === "completed" || run.status === "failed") return result("finished");
  if (config.embeddingJob.owner && config.embeddingJob.leaseUntil > Date.now()) return result("busy");
  config.embeddingJob.owner = owner;
  config.embeddingJob.leaseUntil = Date.now() + leaseMs;
  const claimed = await db.operationRun.updateMany({
    where: { id: run.id, configJson: run.configJson, status: run.status },
    data: { status: "running", configJson: JSON.stringify(config) },
  });
  if (!claimed.count) return result("busy");

  let leaseLost = false;
  async function renew() {
    const current = await db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
    const next = readConfig(current);
    if (current.status !== "running" || next.embeddingJob.owner !== owner || next.embeddingJob.leaseUntil <= Date.now()) { leaseLost = true; return; }
    next.embeddingJob.leaseUntil = Date.now() + leaseMs;
    const updated = await db.operationRun.updateMany({ where: { id: current.id, status: "running", configJson: current.configJson }, data: { configJson: JSON.stringify(next) } });
    if (!updated.count) {
      const latest = await db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
      const latestConfig = readConfig(latest);
      if (latest.status !== "running" || latestConfig.embeddingJob.owner !== owner || latestConfig.embeddingJob.leaseUntil <= Date.now()) leaseLost = true;
    }
  }
  let renewing: Promise<void> | null = null;
  const timer = input.renewLease === false ? null : setInterval(() => {
    if (!renewing) renewing = renew().catch(() => { leaseLost = true; }).finally(() => { renewing = null; });
  }, Math.max(10, Math.floor(leaseMs / 3)));

  try {
    for (const item of config.embeddingJob.items) {
      if (item.status !== "pending") continue;
      const before = await db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
      const beforeConfig = readConfig(before);
      if (before.status !== "running" || beforeConfig.embeddingJob.owner !== owner || beforeConfig.embeddingJob.leaseUntil <= Date.now() || leaseLost) break;
      const bookmark = await db.bookmark.findUnique({ where: { id: item.id } });
      let vector: number[] | undefined;
      let identity: GeneratedEmbedding["identity"] | undefined;
      let error: string | null = null;
      if (bookmark?.summary?.trim()) {
        try {
          const generated = await input.generate(`${bookmark.summary}\n${bookmark.category}\n${bookmark.tags ?? ""}`);
          vector = Array.isArray(generated) ? generated : generated.vector;
          identity = Array.isArray(generated) ? undefined : generated.identity;
        }
        catch (cause) { error = cause instanceof Error ? cause.message : "Embedding failed"; }
      }
      if (renewing) await renewing;
      const committed = await db.$transaction(async (tx) => {
        const current = await tx.operationRun.findUniqueOrThrow({ where: { id: run.id } });
        const next = readConfig(current);
        if (leaseLost || current.status !== "running" || next.embeddingJob.owner !== owner || next.embeddingJob.leaseUntil <= Date.now()) return false;
        const checkpoint = next.embeddingJob.items.find((candidate) => candidate.id === item.id);
        if (!checkpoint || checkpoint.status !== "pending") return false;
        // Fence first. Its reservation and vector write share a transaction, so
        // an expired owner cannot publish a vector or overwrite a new claim.
        const fenced = await tx.operationRun.updateMany({ where: { id: run.id, status: "running", configJson: current.configJson }, data: { configJson: current.configJson } });
        if (!fenced.count) return false;
        let saved = false;
        if (bookmark && vector) {
          try {
            saved = await saveEmbeddingIfUnchanged(tx, { id: bookmark.id, snapshot: contentSnapshot(bookmark), embedding: Buffer.from(new Float32Array(vector).buffer), identity });
          } catch (cause) {
            error = cause instanceof Error ? cause.message : "Database write failed";
          }
        }
        checkpoint.status = error ? "failed" : saved ? "updated" : "skipped";
        next.embeddingJob.leaseUntil = Date.now() + leaseMs;
        const configError = error && /endpoint not found|not found at|Connection refused|ECONNREFUSED|Missing|is not currently available|embedding configuration changed/i.test(error);
        if (configError) next.embeddingJob.error = error;
        await tx.operationRun.update({ where: { id: run.id }, data: { configJson: JSON.stringify(next), ...counts(next.embeddingJob) } });
        if (error || !saved) await tx.processingEvent.create({ data: { runId: run.id, bookmarkId: bookmark?.id ?? null, type: error ? "system" : "bookmark", status: error ? "failed" : "skipped", message: error ?? "Bookmark changed during embedding generation; current edits preserved." } });
        config = next;
        return true;
      });
      if (!committed || config.embeddingJob.error) break;
    }
  } finally {
    if (timer) clearInterval(timer);
    if (renewing) await renewing;
  }
  run = await db.operationRun.findUniqueOrThrow({ where: { id: run.id } });
  config = readConfig(run);
  if (run.status === "stopped") return result("stopped");
  if (leaseLost || config.embeddingJob.owner !== owner || config.embeddingJob.leaseUntil <= Date.now()) return result("busy");
  const total = counts(config.embeddingJob);
  const failed = total.failed > 0 && total.updated === 0;
  config.embeddingJob.error ??= failed ? `All ${total.failed} embedding attempts failed.` : null;
  config.embeddingJob.owner = null;
  config.embeddingJob.leaseUntil = 0;
  const finished = await db.operationRun.updateMany({ where: { id: run.id, status: "running", configJson: run.configJson }, data: { status: failed ? "failed" : "completed", finishedAt: new Date(), notes: config.embeddingJob.error ?? run.notes, configJson: JSON.stringify(config), ...total } });
  return result(finished.count ? "finished" : "busy");
}
