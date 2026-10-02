import { z } from "zod";

export const importEntrySchema = z.object({
  id: z.string(), tweetUrl: z.string(), title: z.string().optional(), text: z.string().optional(),
  authorName: z.string().optional(), authorUsername: z.string().optional(), createdAt: z.string().optional(),
  folderId: z.string().optional(), folderName: z.string().optional(), rawJson: z.string(),
  likeCount: z.number().optional(), replyCount: z.number().optional(), retweetCount: z.number().optional(), quoteCount: z.number().optional(),
  lang: z.string().optional(), externalUrls: z.array(z.string()).optional(), mediaDescription: z.string().optional(), mediaJson: z.string().optional(),
  uploaderChannelId: z.string().optional(), playlistAddedAt: z.string().optional(), availability: z.string().optional(),
});
export type ImportEntry = z.infer<typeof importEntrySchema>;
export const importPageBufferSchema = z.object({ taskId: z.string(), entries: z.array(importEntrySchema), membershipIds: z.array(z.string()), offset: z.number().int().nonnegative(), nextCursor: z.string().nullable() });
export const importJobStateSchema = z.object({
  phase: z.enum(["discover", "import", "enrich", "embedding", "done"]),
  source: z.enum(["x", "yt"]), allFolders: z.boolean(), pipeline: z.boolean(), cap: z.number().int().nonnegative(),
  provider: z.object({ userId: z.string().optional(), endpoint: z.string().optional(), accountFingerprint: z.string().optional(), ownerId: z.string().optional() }),
  folders: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(["pending", "completed", "failed"]), cursor: z.string().nullable(), sequence: z.number().int().nonnegative() })),
  discoveryCursor: z.string().nullable(), discoveryDone: z.boolean(), globalDone: z.boolean(), globalCursor: z.string().nullable(), globalSequence: z.number().int().nonnegative(),
  buffer: importPageBufferSchema.nullable(),
  buffers: z.record(z.string(), importPageBufferSchema).default({}),
  imported: z.number().int().nonnegative(), refreshed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), unavailable: z.number().int().nonnegative(), unavailableStored: z.number().int().nonnegative().default(0), pagesFetched: z.number().int().nonnegative(),
  foldersCompleted: z.number().int().nonnegative(), foldersFailed: z.number().int().nonnegative(), folderTotal: z.number().int().nonnegative(),
  currentFolderId: z.string().nullable(), currentFolderName: z.string().nullable(), folderErrors: z.array(z.object({ folderId: z.string(), message: z.string() })),
  capBlocked: z.boolean(), blockReason: z.string().nullable(), pendingEntries: z.number().int().nonnegative(), hasMore: z.boolean(),
  importedIds: z.array(z.string()), enriched: z.number().int().nonnegative(), indexed: z.number().int().nonnegative(), stageFailed: z.number().int().nonnegative(),
});
export type ImportJobState = z.infer<typeof importJobStateSchema>;
export function initialImportState(input: { source: "x" | "yt"; allFolders: boolean; pipeline: boolean; cap: number; provider: ImportJobState["provider"]; folder?: { id: string; name: string } }): ImportJobState {
  return { ...input, phase: input.folder ? "import" : "discover", folders: input.folder ? [{ ...input.folder, status: "pending", cursor: null, sequence: 0 }] : [],
    discoveryCursor: null, discoveryDone: !!input.folder, globalDone: input.source === "yt" || input.allFolders || !!input.folder, globalCursor: null, globalSequence: 0, buffer: null, buffers: {},
    imported: 0, refreshed: 0, skipped: 0, unavailable: 0, unavailableStored: 0, pagesFetched: 0, foldersCompleted: 0, foldersFailed: 0, folderTotal: input.folder ? 1 : 0,
    currentFolderId: input.folder?.id ?? null, currentFolderName: input.folder?.name ?? null, folderErrors: [], capBlocked: false, blockReason: null, pendingEntries: 0, hasMore: true,
    importedIds: [], enriched: 0, indexed: 0, stageFailed: 0 };
}
