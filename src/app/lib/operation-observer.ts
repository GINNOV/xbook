import { z } from "zod";

export const operationRunSchema = z.object({
  id: z.string(), source: z.string().nullable(), type: z.string(), status: z.string(),
  total: z.number(), processed: z.number(), updated: z.number(), failed: z.number(), skipped: z.number(),
  notes: z.string().nullable().optional(), jobJson: z.string().nullable().optional(),
});
export type ObservedOperation = z.infer<typeof operationRunSchema>;
const checkpointSchema = z.object({
  kind: z.enum(["enrich", "embedding"]),
  scope: z.object({ folderId: z.string().nullable() }),
  items: z.array(z.object({ status: z.string() })),
  error: z.string().nullable(), repairAction: z.string().nullable(),
});
export function operationCheckpoint(run: ObservedOperation) {
  try { return checkpointSchema.parse(JSON.parse(run.jobJson ?? "null")); } catch { return null; }
}
export function operationActive(run: ObservedOperation | null) {
  return run?.status === "queued" || run?.status === "running";
}
export function operationProgress(run: ObservedOperation) {
  const job = operationCheckpoint(run);
  return { ...run, remaining: job ? job.items.filter((item) => item.status === "pending").length : Math.max(0, run.total - run.processed),
    error: job?.error ?? run.notes ?? null, repairAction: job?.repairAction ?? null };
}
export function operationMessage(run: ObservedOperation) {
  const progress = operationProgress(run);
  return `${run.status === "completed" ? "Finished" : run.status[0].toUpperCase() + run.status.slice(1)} · ${run.updated}/${run.total} updated · ${run.failed} failed · ${run.skipped} skipped · ${progress.remaining} remaining.${progress.error ? ` ${progress.error}` : ""}`;
}
export async function readOperationResponse(response: Response) {
  const json: unknown = await response.json();
  const envelope = z.object({ run: operationRunSchema.optional(), runId: z.string().optional(), error: z.string().optional(), message: z.string().optional(), busy: z.boolean().optional(), source: z.string().nullable().optional(), processed: z.number().default(0), updated: z.number().default(0), failed: z.number().default(0), skipped: z.number().default(0), remaining: z.number().default(0) }).parse(json);
  if (envelope.busy) throw new Error(envelope.error ?? "Another operation is active. Open Processing to inspect it.");
  if (!response.ok && !envelope.run && !envelope.runId) throw new Error(envelope.error ?? `Request failed (${response.status})`);
  return envelope;
}
