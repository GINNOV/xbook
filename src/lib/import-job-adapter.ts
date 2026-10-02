import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { operationAdapter } from "./operation-adapters";
import { OperationItemError, type JobAdapter, type OperationJob } from "./operation-job";
import { importEntrySchema, type ImportEntry, type ImportJobState } from "./import-job-contract";
import { getAuthContext as getXAuthContext, fetchXImportFolders, fetchXImportPage, hydrateXImportIds } from "./x";
import { getAuthContext as getYouTubeAuthContext, validateYouTubeImportClient, fetchYouTubeImportFolders, fetchYouTubeImportPage } from "./youtube";

function acceptOwner(state: ImportJobState, ownerId: unknown, hasEntries: boolean) {
  if (state.source !== "yt") return;
  if (hasEntries && (typeof ownerId !== "string" || !ownerId.trim())) throw new Error("YouTube configuration changed: playlist owner is missing from the provider response.");
  if (typeof ownerId === "string" && state.provider.ownerId && state.provider.ownerId !== ownerId) throw new Error("YouTube configuration changed: playlist owner does not match this import.");
}
function entry(input: unknown): ImportEntry { return importEntrySchema.parse(JSON.parse(JSON.stringify(input))); }
function pending(id: string) { return { id, status: "pending" as const, attempts: 0, retryAt: 0, error: null }; }
function enqueue(job: OperationJob, id: string) { if (job.items.some((item) => item.id === id)) return false; job.items.push(pending(id)); return true; }
function bufferedRemaining(state: ImportJobState) { return Object.values(state.buffers).reduce((total, buffer) => total + buffer.entries.length - buffer.offset, 0); }
function month(source: "x" | "yt") { const now = new Date(); const value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; return { id: `${value}:${source}`, month: value, source }; }
function mergedRaw(previous: string | null, incoming: string) {
  try { const old: unknown = JSON.parse(previous ?? "{}"); const fresh: unknown = JSON.parse(incoming); if (old && fresh && typeof old === "object" && typeof fresh === "object" && !Array.isArray(old) && !Array.isArray(fresh)) return JSON.stringify({ ...old, ...fresh }); } catch { /* Keep valid provider refresh when old raw is invalid. */ }
  return incoming;
}
function finishStage(job: OperationJob, id: string) {
  const kind = id.startsWith("enrich:") ? "enrich" : "embedding";
  if (job.items.some((item) => item.id !== id && item.status === "pending" && item.id.startsWith(`${kind}:`))) return;
  if (kind === "enrich") {
    for (const candidate of job.import!.importedIds) enqueue(job, `embedding:${candidate}`);
    job.import!.phase = job.items.some((item) => item.status === "pending" && item.id.startsWith("embedding:")) ? "embedding" : "done";
  } else job.import!.phase = "done";
  if (job.import!.phase === "done") job.import!.hasMore = false;
}
function continueImport(job: OperationJob) {
  const state = job.import!;
  if (!state.discoveryDone || state.folders.some((folder) => folder.status === "pending") || !state.globalDone) return;
  if (state.pipeline && state.phase !== "enrich" && state.phase !== "embedding" && state.importedIds.length) {
    for (const id of state.importedIds) enqueue(job, `enrich:${id}`);
    state.phase = job.items.some((item) => item.status === "pending" && item.id.startsWith("enrich:")) ? "enrich" : job.items.some((item) => item.status === "pending" && item.id.startsWith("embedding:")) ? "embedding" : "done";
  } else state.phase = "done";
  if (state.phase === "done") state.hasMore = false;
}
async function budget(tx: Pick<Prisma.TransactionClient, "usageMonth">, state: ImportJobState) {
  const key = month(state.source);
  const usage = await tx.usageMonth.findUnique({ where: { id: key.id } });
  return Math.max(0, state.cap - (usage?.usedBookmarks ?? 0));
}

export function importOperationAdapter(): JobAdapter {
  return {
    preflight: async (job, signal) => {
      const state = job.import!;
      if (!job.items.some((item) => item.status === "pending" && !/^(enrich|embedding):/.test(item.id))) return;
      if (state.source === "yt") { await validateYouTubeImportClient(state.provider); signal.throwIfAborted(); await getYouTubeAuthContext(signal); }
      else { const auth = await getXAuthContext(signal); if (auth.userId !== state.provider.userId || auth.apiBase !== state.provider.endpoint) throw new Error("X configuration changed. Restore the original account before resuming."); }
    },
    onFailure: async (_tx, job, id, message) => {
      const state = job.import!;
      if (id.startsWith("enrich:" ) || id.startsWith("embedding:")) { state.stageFailed++; finishStage(job, id); return; }
      const folder = state.folders.find((candidate) => id.startsWith(`folder:${candidate.id}:`));
      if (folder && folder.status !== "failed") { folder.status = "failed"; state.foldersFailed++; state.folderErrors.push({ folderId: folder.id, message }); }
      if (id.startsWith("global:")) state.globalDone = true;
      if (id.startsWith("discover:")) { state.discoveryDone = true; state.foldersFailed++; state.folderErrors.push({ folderId: "discovery", message }); if (!state.globalDone) enqueue(job, "global:0"); }
      continueImport(job);
    },
    execute: async (id, job, signal, runId, persistPreparation) => {
      const state = job.import;
      if (!state) throw new Error("Missing import checkpoint");
      if (id.startsWith("enrich:") || id.startsWith("embedding:")) {
        const kind = id.startsWith("enrich:") ? "enrich" : "embedding";
        const bookmarkId = id.slice(kind.length + 1);
        const stage = operationAdapter({ ...job, kind });
        await stage.preflight?.({ ...job, kind }, signal);
        const commit = await stage.execute(bookmarkId, { ...job, kind }, signal, runId, persistPreparation);
        return async (tx, draft) => {
          const result = await commit(tx, draft);
          if (result === "updated") { if (kind === "enrich") draft.import!.enriched++; else draft.import!.indexed++; }
          else if (result === "skipped") draft.import!.skipped++;
          finishStage(draft, id);
          return result;
        };
      }
      try {
        if (id.startsWith("discover:")) {
          const page = state.source === "x" ? await fetchXImportFolders({ provider: state.provider, cursor: state.discoveryCursor, signal }) : await fetchYouTubeImportFolders(state.discoveryCursor, signal, state.provider);
          acceptOwner(state, "ownerId" in page ? page.ownerId : undefined, page.folders.length > 0);
          if (page.nextCursor && page.nextCursor === state.discoveryCursor) throw new Error("Provider repeated a discovery cursor.");
          return async (tx, draft) => {
            const next = draft.import!;
            if ("ownerId" in page && typeof page.ownerId === "string") next.provider.ownerId ??= page.ownerId;
            for (const folder of page.folders) {
              await tx.bookmarkFolder.upsert({ where: { id: folder.id }, create: { id: folder.id, name: folder.name }, update: { name: folder.name } });
              if (next.source === "yt") {
                const playlistId = folder.id.replace(/^yt:pl:/, "");
                await tx.$executeRaw`UPDATE "Bookmark" SET "folderId" = ${folder.id} WHERE "source" = 'yt' AND "folderId" IS NULL AND (CASE WHEN json_valid("rawJson") THEN json_extract("rawJson", '$.playlistId') ELSE NULL END) = ${playlistId}`;
              }
              if (!next.folders.some((candidate) => candidate.id === folder.id)) { next.folders.push({ ...folder, status: "pending", cursor: null, sequence: 0 }); enqueue(draft, `folder:${folder.id}:0`); }
            }
            next.folderTotal = next.folders.length; next.discoveryCursor = page.nextCursor; next.discoveryDone = !page.nextCursor; next.phase = "import";
            if (page.nextCursor) enqueue(draft, `discover:${next.folders.length}:${page.nextCursor}`);
            else if (!next.globalDone) enqueue(draft, "global:0");
            continueImport(draft); return "updated";
          };
        }
        const folder = state.folders.find((candidate) => id.startsWith(`folder:${candidate.id}:`));
        const cursor = folder ? folder.cursor : state.globalCursor;
        let buffer = state.buffers[id] ? structuredClone(state.buffers[id]) : state.buffer?.taskId === id ? structuredClone(state.buffer) : null;
        if (!buffer) {
          const page = state.source === "x" ? await fetchXImportPage({ provider: state.provider, folderId: folder?.id, folderName: folder?.name, cursor, signal }) : await fetchYouTubeImportPage({ folderId: folder!.id, folderName: folder!.name, cursor, signal, provider: state.provider });
          acceptOwner(state, "ownerId" in page ? page.ownerId : undefined, page.ids.length > 0);
          if (page.nextCursor && page.nextCursor === cursor) throw new Error("Provider repeated an import cursor.");
          const hydrated = new Map(page.items.map((item) => [item.id, entry(item)]));
          buffer = { taskId: id, entries: page.ids.map((itemId) => hydrated.get(itemId) ?? { id: itemId, tweetUrl: `https://x.com/i/status/${itemId}`, folderId: folder?.id, folderName: folder?.name, rawJson: "" }), membershipIds: page.ids, offset: 0, nextCursor: page.nextCursor };
          const saved = await persistPreparation?.(async (_tx, draft) => { if ("ownerId" in page && typeof page.ownerId === "string") draft.import!.provider.ownerId ??= page.ownerId; draft.import!.buffer = buffer; draft.import!.buffers[id] = buffer!; draft.import!.pagesFetched++; draft.import!.unavailable += "unavailable" in page && typeof page.unavailable === "number" ? page.unavailable : 0; draft.import!.pendingEntries = bufferedRemaining(draft.import!); draft.import!.hasMore = !!buffer!.nextCursor || !draft.import!.discoveryDone || (!draft.import!.globalDone && !id.startsWith("global:")) || draft.import!.folders.some((candidate) => candidate.status === "pending" && candidate.id !== folder?.id); draft.import!.currentFolderId = folder?.id ?? null; draft.import!.currentFolderName = folder?.name ?? null; });
          if (saved === false) throw new Error("Operation aborted");
        }
        if (state.source === "x" && folder) {
          const candidates = buffer.entries.slice(buffer.offset).filter((candidate) => !candidate.rawJson);
          const known = new Set((await prisma.bookmark.findMany({ where: { id: { in: candidates.map((candidate) => candidate.id) } }, select: { id: true } })).map((candidate) => candidate.id));
          const available = await budget(prisma, state);
          const ids = candidates.filter((candidate) => !known.has(candidate.id)).slice(0, available).map((candidate) => candidate.id);
          if (ids.length) {
            const found = new Map((await hydrateXImportIds({ provider: state.provider, ids, folderId: folder.id, folderName: folder.name, signal })).map((item) => [item.id, entry(item)]));
            buffer.entries = buffer.entries.map((candidate) => ids.includes(candidate.id) ? found.get(candidate.id) ?? { ...candidate, rawJson: "__unavailable__" } : candidate);
            const saved = await persistPreparation?.(async (_tx, draft) => { draft.import!.buffer = buffer; draft.import!.buffers[id] = buffer!; });
            if (saved === false) throw new Error("Operation aborted");
          }
        }
        return async (tx, draft) => {
          const next = draft.import!; next.buffer = structuredClone(buffer!); next.buffers[id] = next.buffer;
          let available = await budget(tx, next);
          while (next.buffer.offset < next.buffer.entries.length) {
            const candidate = next.buffer.entries[next.buffer.offset];
            const existing = await tx.bookmark.findUnique({ where: { id: candidate.id } });
            if (candidate.rawJson === "__unavailable__") { next.unavailable++; next.buffer.offset++; continue; }
            if (!existing && (!available || !candidate.rawJson)) {
              next.capBlocked = true; next.blockReason = "Monthly new-entry cap reached. Raise the source cap or resume next month."; draft.error = next.blockReason; draft.repairAction = "/settings?tab=limits"; next.pendingEntries = bufferedRemaining(next); return "pending";
            }
            const data = { source: next.source, tweetUrl: candidate.tweetUrl, ...(candidate.text !== undefined ? { text: candidate.text } : {}), ...(candidate.authorName !== undefined ? { authorName: candidate.authorName } : {}), ...(candidate.authorUsername !== undefined ? { authorUsername: candidate.authorUsername } : {}), ...(candidate.createdAt ? { createdAt: new Date(candidate.createdAt) } : {}), ...(candidate.folderId ? { folderId: candidate.folderId } : {}), ...(candidate.rawJson ? { rawJson: mergedRaw(existing?.rawJson ?? null, candidate.rawJson) } : {}), ...(candidate.externalUrls ? { externalUrls: JSON.stringify(candidate.externalUrls) } : {}), ...(candidate.mediaDescription !== undefined ? { mediaDescription: candidate.mediaDescription } : {}), ...(candidate.mediaJson !== undefined ? { mediaJson: candidate.mediaJson } : {}), ...(candidate.uploaderChannelId ? { uploaderChannelId: candidate.uploaderChannelId } : {}), ...(candidate.playlistAddedAt ? { playlistAddedAt: new Date(candidate.playlistAddedAt) } : {}), ...(candidate.availability ? { availability: candidate.availability } : {}), ...(candidate.likeCount !== undefined ? { likeCount: candidate.likeCount } : {}), ...(candidate.replyCount !== undefined ? { replyCount: candidate.replyCount } : {}), ...(candidate.retweetCount !== undefined ? { retweetCount: candidate.retweetCount } : {}), ...(candidate.quoteCount !== undefined ? { quoteCount: candidate.quoteCount } : {}), ...(candidate.lang !== undefined ? { lang: candidate.lang } : {}) };
            const sourceData = next.source === "yt" ? { ...data, authorName: candidate.authorName ?? null, authorUsername: candidate.authorUsername ?? null, createdAt: candidate.createdAt ? new Date(candidate.createdAt) : null, uploaderChannelId: candidate.uploaderChannelId ?? null, playlistAddedAt: candidate.playlistAddedAt ? new Date(candidate.playlistAddedAt) : null } : data;
            if (existing) { await tx.bookmark.update({ where: { id: candidate.id }, data: sourceData }); next.refreshed++; }
            else { await tx.bookmark.create({ data: { id: candidate.id, ...sourceData } }); await tx.usageMonth.upsert({ where: { id: month(next.source).id }, create: { ...month(next.source), usedBookmarks: 1 }, update: { usedBookmarks: { increment: 1 } } }); available--; next.imported++; }
            if (candidate.availability === "unavailable") { next.unavailable++; next.unavailableStored++; }
            if (next.pipeline && candidate.availability !== "unavailable" && !next.importedIds.includes(candidate.id)) next.importedIds.push(candidate.id);
            next.buffer.offset++;
          }
          const nextCursor = next.buffer.nextCursor; delete next.buffers[id]; next.buffer = null; next.pendingEntries = bufferedRemaining(next);
          const current = next.folders.find((candidate) => candidate.id === folder?.id);
          if (current) { current.cursor = nextCursor; current.sequence++; if (nextCursor) enqueue(draft, `folder:${current.id}:${current.sequence}`); else { current.status = "completed"; next.foldersCompleted++; await tx.bookmarkFolder.update({ where: { id: current.id }, data: { lastFetchedAt: new Date() } }); } }
          else { next.globalCursor = nextCursor; next.globalSequence++; next.globalDone = !nextCursor; if (nextCursor) enqueue(draft, `global:${next.globalSequence}`); }
          continueImport(draft); return "updated";
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Import failed";
        if (/quota reached/i.test(message) && !signal.aborted) return async (_tx, draft) => { draft.import!.blockReason = message; draft.error = message; draft.repairAction = "/settings?tab=connections"; return "pending"; };
        if ((id.startsWith("folder:") || id.startsWith("discover:")) && /API error 404|not found|removed|playlistNotFound/i.test(message)) throw new OperationItemError(message, { configuration: false, transient: false });
        throw error;
      }
    },
  };
}
