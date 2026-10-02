import { z } from "zod";
import { importJobStateSchema } from "@/lib/import-job-contract";

export const operationRunSchema = z.object({
  id: z.string(), source: z.string().nullable(), type: z.string(), status: z.string(),
  total: z.number(), processed: z.number(), updated: z.number(), failed: z.number(), skipped: z.number(),
  notes: z.string().nullable().optional(), jobJson: z.string().nullable().optional(), configJson: z.string().nullable().optional(),
});
export type ObservedOperation = z.infer<typeof operationRunSchema>;
const checkpointSchema = z.object({
  kind: z.enum(["enrich", "embedding", "import"]),
  import: importJobStateSchema.pick({ phase: true, pipeline: true, imported: true, refreshed: true, skipped: true, unavailable: true, pagesFetched: true, foldersCompleted: true, foldersFailed: true, folderTotal: true, capBlocked: true, currentFolderId: true, currentFolderName: true, pendingEntries: true, hasMore: true, blockReason: true, folderErrors: true, enriched: true, indexed: true, stageFailed: true }).nullable().optional(),
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
  let repairAction = job?.repairAction ?? null;
  if (!repairAction) {
    try { repairAction = z.object({ repairAction: z.string().nullable().optional() }).parse(JSON.parse(run.configJson ?? "null")).repairAction ?? null; } catch { /* Earlier runs may not have repair metadata. */ }
  }
  return { ...run, remaining: job ? job.items.filter((item) => item.status === "pending").length : Math.max(0, run.total - run.processed),
    error: job?.error ?? run.notes ?? null, repairAction };
}
export function operationMessage(run: ObservedOperation) {
  const progress = operationProgress(run);
  const importing = operationCheckpoint(run)?.import;
  if (importing) return `${run.status[0].toUpperCase() + run.status.slice(1)} · ${importing.phase === "done" ? "Import finished" : importing.phase === "enrich" ? "Summarizing" : importing.phase === "embedding" ? "Indexing" : importing.phase === "discover" ? "Discovering folders" : "Importing"}${importing.currentFolderName ? ` ${importing.currentFolderName}` : ""} · ${importing.imported} new · ${importing.refreshed} refreshed · ${importing.skipped} skipped · ${importing.unavailable} unavailable · ${importing.pagesFetched} pages fetched${importing.pipeline ? ` · ${importing.enriched} summarized · ${importing.indexed} indexed${importing.stageFailed ? ` · ${importing.stageFailed} processing failures` : ""}` : ""} · ${importing.foldersCompleted}/${importing.folderTotal} folders finished${importing.foldersFailed ? ` · ${importing.foldersFailed} folders failed` : ""}${importing.pendingEntries ? ` · ${importing.pendingEntries} buffered entries pending` : ""}${importing.hasMore ? " · more pages pending" : ""}.${progress.error ?? importing.blockReason ? ` ${progress.error ?? importing.blockReason}` : ""}`;
  return `${run.status === "completed" ? "Finished" : run.status[0].toUpperCase() + run.status.slice(1)} · ${run.updated}/${run.total} updated · ${run.failed} failed · ${run.skipped} skipped · ${progress.remaining} remaining.${progress.error ? ` ${progress.error}` : ""}`;
}
export async function readOperationResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) throw new Error(`Empty response from server (${response.status}). Open Processing to check the operation before submitting again.`);
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error(`Invalid response from server (${response.status}). Open Processing to check the operation.`); }
  const envelope = z.object({ run: operationRunSchema.optional(), runId: z.string().optional(), error: z.string().nullable().optional(), message: z.string().nullable().optional(), busy: z.boolean().optional(), source: z.string().nullable().optional(), processed: z.number().default(0), updated: z.number().default(0), failed: z.number().default(0), skipped: z.number().default(0), remaining: z.number().default(0) }).parse(json);
  if (envelope.busy) throw new Error(envelope.error ?? "Another operation is active. Open Processing to inspect it.");
  if (!response.ok && !envelope.run && !envelope.runId) throw new Error(envelope.error ?? `Request failed (${response.status})`);
  return envelope;
}
