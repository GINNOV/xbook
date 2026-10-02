import { initialImportState } from "@/lib/import-job-contract";

export function importOperationFixture(input: { source?: "x" | "yt"; status?: string; imported?: number; refreshed?: number; pipeline?: boolean; capBlocked?: boolean } = {}) {
  const source = input.source ?? "x";
  const state = initialImportState({ source, allFolders: true, pipeline: input.pipeline ?? false, cap: 100, provider: {} });
  Object.assign(state, { phase: input.status === "paused" ? "import" : "done", imported: input.imported ?? 5, refreshed: input.refreshed ?? 0, folderTotal: 2, foldersCompleted: 2, pagesFetched: 3, hasMore: input.status === "paused", capBlocked: input.capBlocked ?? false });
  return { id: "import-fixture-run", source, type: input.pipeline ? "import_pipeline" : "x_folder_import", status: input.status ?? "completed", total: 3, processed: state.imported + state.refreshed, updated: state.imported + state.refreshed, failed: 0, skipped: 0, notes: null,
    jobJson: JSON.stringify({ kind: "import", scope: { folderId: null }, items: [{ status: input.status === "paused" ? "pending" : "updated" }], import: state, error: input.capBlocked ? "Monthly new-entry cap reached" : null, repairAction: input.capBlocked ? "/settings?tab=connections" : null }) };
}
