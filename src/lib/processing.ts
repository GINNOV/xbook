import { pendingEnrichmentWhere } from "@/lib/bookmarks";
import { prisma } from "@/lib/db";
import { processingEvents } from "@/lib/signals";
import { z } from "zod";

import { resolveRunStatus, terminalRunStatuses, type RunStatus } from "@/lib/run-outcome";
export { resolveRunStatus, type RunStatus } from "@/lib/run-outcome";

type EventStatus =
  | "queued"
  | "fetching"
  | "sent_to_llm"
  | "completed"
  | "failed"
  | "skipped"
  | "stopped"
  | "retrying";

const preview = (value?: string | null, max = 500) => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
};

const stringify = (value: unknown) => {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export async function createOperationRun(input: {
  type: string;
  source?: string | null;
  status?: RunStatus;
  total?: number;
  notes?: string | null;
  /** JSON string or object snapshot of model / endpoint / knobs. */
  config?: string | Record<string, unknown> | null;
}) {
  let configJson: string | null = null;
  if (typeof input.config === "string") {
    configJson = input.config;
  } else if (input.config && typeof input.config === "object") {
    try {
      configJson = JSON.stringify(input.config);
    } catch {
      configJson = null;
    }
  }

  const run = await prisma.operationRun.create({
    data: {
      type: input.type,
      source: input.source ?? null,
      status: input.status ?? "running",
      total: input.total ?? 0,
      notes: input.notes ?? null,
      configJson,
    },
  });
  processingEvents.emit("run_created", run);
  return run;
}

export async function updateOperationRun(
  runId: string | null | undefined,
  input: {
    status?: RunStatus;
    total?: number;
    processed?: number;
    updated?: number;
    failed?: number;
    skipped?: number;
    notes?: string | null;
    finish?: boolean;
    remaining?: number;
    preflightError?: boolean;
    /** Shallow-merged into existing configJson (batch progress, etc.). */
    configPatch?: Record<string, unknown> | null;
  }
) {
  if (!runId) return null;

  const run = await prisma.$transaction(async (tx) => {
    // Reserve SQLite's write lock before reading so a stop cannot race the update.
    await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
    const existing = await tx.operationRun.findUnique({ where: { id: runId } });
    if (!existing || terminalRunStatuses.includes(existing.status)) return existing;
    let configJson = existing.configJson;
    if (input.configPatch) {
      let base: Record<string, unknown> = {};
      try {
        const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(configJson ?? "{}"));
        if (parsed.success) base = parsed.data;
      } catch { /* Older malformed configuration. */ }
      configJson = JSON.stringify({ ...base, ...input.configPatch });
    }
    const status = resolveRunStatus({ ...existing, ...input, status: input.status ?? existing.status });
    const changed = await tx.operationRun.updateMany({
      where: { id: runId, status: existing.status },
      data: {
        status,
        ...(input.total !== undefined ? { total: input.total } : {}),
        ...(input.processed !== undefined ? { processed: input.processed } : {}),
        ...(input.updated !== undefined ? { updated: input.updated } : {}),
        ...(input.failed !== undefined ? { failed: input.failed } : {}),
        ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.configPatch ? { configJson } : {}),
        ...(input.finish || terminalRunStatuses.includes(status) ? { finishedAt: status === "paused" ? null : new Date() } : {}),
      },
    });
    return changed.count ? tx.operationRun.findUnique({ where: { id: runId } }) : existing;
  });
  processingEvents.emit("run_updated", run);
  return run;
}

export async function incrementOperationRun(
  runId: string | null | undefined,
  input: {
    status?: RunStatus;
    processed?: number;
    updated?: number;
    failed?: number;
    skipped?: number;
    notes?: string | null;
    finish?: boolean;
  }
) {
  if (!runId) return null;
  const run = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "OperationRun" SET "status" = "status" WHERE 0`;
    const existing = await tx.operationRun.findUnique({ where: { id: runId } });
    if (!existing || !["queued", "running"].includes(existing.status)) return existing;
    const counts = {
      processed: existing.processed + (input.processed ?? 0),
      updated: existing.updated + (input.updated ?? 0),
      failed: existing.failed + (input.failed ?? 0),
      skipped: existing.skipped + (input.skipped ?? 0),
    };
    const status = resolveRunStatus({ ...existing, ...counts, status: input.status ?? existing.status });
    await tx.operationRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running"] } },
      data: {
        ...counts,
        status,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.finish || terminalRunStatuses.includes(status) ? { finishedAt: status === "paused" ? null : new Date() } : {}),
      },
    });
    return tx.operationRun.findUnique({ where: { id: runId } });
  });
  processingEvents.emit("run_updated", run);
  return run;
}

export async function logProcessingEvent(input: {
  runId?: string | null;
  bookmarkId?: string | null;
  type: string;
  status: EventStatus;
  message?: string | null;
  metadata?: unknown;
}) {
  if (!input.runId) return null;
  try {
    const event = await prisma.processingEvent.create({
      data: {
        runId: input.runId,
        bookmarkId: input.bookmarkId ?? null,
        type: input.type,
        status: input.status,
        message: input.message ?? null,
        metadataJson: stringify(input.metadata),
      },
    });
    processingEvents.emit("event_logged", event);
    return event;
  } catch (error) {
    // Handle foreign key violation (e.g. run deleted while processing)
    if (error instanceof Error && (error as { code?: string }).code === "P2003") {
      return null;
    }
    throw error;
  }
}

export async function logLlmRequest(input: {
  runId?: string | null;
  bookmarkId?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  prompt?: string | null;
  response?: string | null;
  parsed?: unknown;
  durationMs?: number | null;
  tokenUsage?: unknown;
  error?: string | null;
  includePayloads?: boolean;
}) {
  const includePayloads = input.includePayloads ?? true;
  try {
    return await prisma.llmRequestLog.create({
      data: {
        runId: input.runId ?? null,
        bookmarkId: input.bookmarkId ?? null,
        model: input.model ?? null,
        baseUrl: input.baseUrl ? safeBaseUrl(input.baseUrl) : null,
        promptPreview: preview(input.prompt),
        prompt: includePayloads ? input.prompt ?? null : null,
        responsePreview: preview(input.response),
        response: includePayloads ? input.response ?? null : null,
        parsedJson: stringify(input.parsed),
        durationMs: input.durationMs ?? null,
        tokenUsageJson: stringify(input.tokenUsage),
        error: input.error ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === "P2003") {
      return null;
    }
    throw error;
  }
}

function safeBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

export async function clearProcessingLogs() {
  const inactiveRunIds = (await prisma.operationRun.findMany({
    where: { status: { in: ["completed", "partial", "failed", "stopped"] } },
    select: { id: true }
  })).map(r => r.id);

  if (inactiveRunIds.length === 0) return;

  await prisma.processingEvent.deleteMany({
    where: { runId: { in: inactiveRunIds } }
  });
  await prisma.llmRequestLog.deleteMany({
    where: { runId: { in: inactiveRunIds } }
  });
  await prisma.operationRun.deleteMany({
    where: { id: { in: inactiveRunIds } }
  });
}

export async function clearProcessingLogsForRunIds(runIds: string[]) {
  if (!runIds.length) return { deletedRuns: 0 };

  await prisma.processingEvent.deleteMany({
    where: { runId: { in: runIds } },
  });
  await prisma.llmRequestLog.deleteMany({
    where: { runId: { in: runIds } },
  });
  await prisma.operationRun.deleteMany({
    where: { id: { in: runIds } },
  });

  return { deletedRuns: runIds.length };
}

export async function getActiveRun(source?: string | null) {
  return prisma.operationRun.findFirst({
    where: {
      status: { in: ["queued", "running"] },
      ...(source ? { source } : {}),
    },
  });
}

export async function getProcessingSummary(source?: string | null) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const filter = source ? { source } : {};

  const [activeOperations, itemsSummaryToday, totalItems, pendingEnrichment, lastLlm] =
    await Promise.all([
      prisma.operationRun.count({
        where: { 
          status: { in: ["queued", "running"] },
          ...filter
        },
      }),
      prisma.operationRun.aggregate({
        where: { 
          startedAt: { gte: since },
          ...filter
        },
        _sum: {
          updated: true,
          failed: true,
        },
      }),
      prisma.bookmark.count({
        where: filter,
      }),
      prisma.bookmark.count({
        where: {
          ...filter,
          ...pendingEnrichmentWhere(),
        },
      }),
      prisma.llmRequestLog.findFirst({
        where: source ? { run: { source } } : {},
        orderBy: { createdAt: "desc" },
        select: { durationMs: true, createdAt: true, error: true },
      }),
    ]);

  return {
    activeOperations,
    completedToday: itemsSummaryToday._sum.updated ?? 0,
    failedToday: itemsSummaryToday._sum.failed ?? 0,
    totalItems,
    totalEnriched: totalItems - pendingEnrichment,
    pendingEnrichment,
    lastLlm,
  };
}
