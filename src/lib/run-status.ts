export type RunCounters = {
  status?: string | null;
  updated?: number | null;
  failed?: number | null;
  skipped?: number | null;
  processed?: number | null;
  remaining?: number | null;
  notes?: string | null;
  cancelled?: boolean;
  preflight?: boolean;
};

/** Honest terminal status. Historical rows are not rewritten; display uses the same rules. */
export function classifyRunStatus(input: RunCounters): "completed" | "partial" | "failed" | "stopped" | "paused" {
  const updated = input.updated ?? 0;
  const failed = input.failed ?? 0;
  const remaining = input.remaining ?? 0;
  const status = (input.status ?? "").toLowerCase();
  if (input.cancelled || status === "stopped") return "stopped";
  if (input.preflight || /paused|more remaining/i.test(input.notes ?? "")) {
    if (remaining > 0 || /paused|more remaining/i.test(input.notes ?? "")) return "paused";
  }
  if (remaining > 0) return "paused";
  if (updated === 0 && failed > 0) return "failed";
  if (updated > 0 && failed > 0) return "partial";
  return "completed";
}
