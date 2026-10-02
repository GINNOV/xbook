"use client";

import Link from "next/link";
import { formatFolderActivity } from "@/app/lib/formatters";
import { YouTubeLogo } from "./Icons";
import { useFoldersPanel, type Folder } from "../hooks/useFoldersPanel";
import { folderLibraryHref } from "../lib/folder-links";
import OperationStatus from "./OperationStatus";
import YouTubeMetadataRepair from "./YouTubeMetadataRepair";

type Props = { folders: Folder[]; localEntries?: number; uniqueVideos?: number; soundOnComplete?: boolean; soundOnError?: boolean };
export default function YouTubeFoldersPanel({ folders, localEntries, uniqueVideos, soundOnComplete, soundOnError }: Props) {
  const { operation, msg, loading, syncFolders, importFolder, importAllFolders, processFolder, indexFolder } = useFoldersPanel(folders, soundOnComplete, soundOnError, "yt");
  const busy = loading.syncing || loading.all || !!loading.importing || !!loading.processing || !!loading.indexing || operation.active || operation.submitting;
  const button = "rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-black hover:text-white disabled:opacity-60";
  return <section className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white/70 p-6 shadow-sm">
    <OperationStatus operation={operation} />
    {msg?.text && (!operation.run || operation.connectionError) && <p role={msg.isError ? "alert" : "status"} className={msg.isError ? "text-error text-sm" : "text-sm"}>{msg.text}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-2xl font-semibold"><YouTubeLogo className="h-5 w-7" />Playlists</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void importAllFolders()} className={button}>{loading.all ? "Importing…" : "Import all playlists"}</button>
        <button type="button" disabled={busy} onClick={() => void syncFolders()} className={button}>{loading.syncing ? "Syncing…" : "Sync playlist names"}</button>
      </div>
    </div>
    <p className="text-xs text-on-surface-variant">{localEntries ?? folders.reduce((total, folder) => total + (folder.total ?? 0), 0)} local playlist entries{uniqueVideos !== undefined ? ` · ${uniqueVideos} unique videos` : ""}. A video in multiple playlists has a separate local entry in each. Import fetches entries; Summarize creates digests; Index builds search vectors.</p>
    <YouTubeMetadataRepair />
    {folders.length ? <div className="overflow-x-auto rounded-lg border border-black/10"><table className="w-full text-left text-sm">
      <thead className="bg-surface-container text-xs font-semibold text-on-surface-variant"><tr><th className="px-4 py-2">Playlist name</th><th className="px-4 py-2">Local entries</th><th className="px-4 py-2">Fetched</th><th className="px-4 py-2">Summarized</th><th className="px-4 py-2 text-right">Actions</th></tr></thead>
      <tbody className="divide-y divide-black/5 bg-white">{folders.map((folder) => <tr key={folder.id}>
        <td className="px-4 py-3 font-semibold"><Link className="text-primary hover:underline" href={folderLibraryHref("yt", folder.id)}>{folder.name ?? "Unknown playlist"}</Link></td>
        <td className="px-4 py-3"><Link aria-label={`Open ${folder.total ?? 0} local entries in ${folder.name ?? "Unknown playlist"}`} className="text-primary hover:underline" href={folderLibraryHref("yt", folder.id)}>{folder.total ?? 0}</Link>
          {folder.uniqueVideos !== undefined && <span className="block text-xs text-on-surface-variant">{folder.uniqueVideos} unique local videos</span>}
          {folder.sourceEntries !== null && folder.sourceEntries !== undefined && <span className="block text-xs text-on-surface-variant">{folder.sourceEntries} source playlist entries</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">{formatFolderActivity(folder.lastFetchedAt)}</td><td className="px-4 py-3 whitespace-nowrap">{formatFolderActivity(folder.lastProcessedAt)}</td>
        <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => void importFolder(folder.id)} className={button} title="Fetch entries from this playlist; preserve existing summaries.">{loading.importing === folder.id ? "Importing…" : "Import"}</button>
          <button type="button" disabled={busy || !folder.total} onClick={() => void processFolder(folder.id)} className={button} title="Summarize items already imported in this playlist.">{loading.processing === folder.id ? "Summarizing…" : "Summarize"}</button>
          <button type="button" disabled={busy || !folder.total} onClick={() => void indexFolder(folder.id)} className={button} title="Rebuild missing or incompatible search vectors for this playlist.">{loading.indexing === folder.id ? "Indexing…" : "Index"}</button>
        </div></td>
      </tr>)}</tbody>
    </table></div> : <p className="text-sm text-on-surface-variant">No playlists saved yet. Sync playlist names or import your playlists to get started.</p>}
  </section>;
}
