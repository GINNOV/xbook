import type { Prisma } from "@prisma/client";

export type RunStatus = "queued" | "running" | "paused" | "completed" | "partial" | "failed" | "stopped";

export type RunOutcome = {
  status: string;
  processed?: number | null;
  updated?: number | null;
  failed?: number | null;
  skipped?: number | null;
  notes?: string | null;
  remaining?: number;
  preflightError?: boolean;
};

export const terminalRunStatuses = ["completed", "partial", "failed", "stopped"];

const legacyPaused: Prisma.OperationRunWhereInput = { status: "completed", notes: { contains: "paused (more remaining)" } };
const notLegacyPaused: Prisma.OperationRunWhereInput = { OR: [{ notes: null }, { notes: { not: { contains: "paused (more remaining)" } } }] };
const allFailed: Prisma.OperationRunWhereInput = { failed: { gt: 0 }, updated: 0 };

/** Keep history filters consistent with corrected legacy display labels. */
export function runStatusWhere(status: string): Prisma.OperationRunWhereInput {
  if (status === "failed") return { OR: [{ status: "failed" }, { status: "completed", ...allFailed }] };
  if (status === "paused") return { OR: [{ status: "paused" }, { AND: [legacyPaused, { NOT: allFailed }] }] };
  if (status === "partial") return { OR: [{ status: "partial" }, { status: "completed", failed: { gt: 0 }, updated: { gt: 0 }, AND: [notLegacyPaused] }] };
  if (status === "completed") return { status: "completed", failed: 0, AND: [notLegacyPaused] };
  return { status };
}

/** Resolve recorded outcomes without treating the scope total as attempted work. */
export function resolveRunStatus(run: RunOutcome): string {
  if (run.status === "stopped") return "stopped";
  if (run.preflightError || run.status === "failed") return "failed";
  if (run.status !== "completed" && run.status !== "partial") return run.status;
  const failed = run.failed ?? 0;
  const updated = run.updated ?? 0;
  if (failed > 0 && updated === 0) return "failed";
  if ((run.remaining ?? 0) > 0 || /paused\s*\(more remaining\)|paused.*work remaining/i.test(run.notes ?? "")) return "paused";
  if (failed > 0) return "partial";
  return "completed";
}
