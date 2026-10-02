"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { playSuccessSound, playErrorSound } from "@/lib/audio";
import { formatFolderActivity } from "@/app/lib/formatters";
import { YouTubeLogo } from "./Icons";
import { useOperationObserver } from "../hooks/useOperationObserver";
import { operationMessage } from "../lib/operation-observer";
import OperationStatus from "./OperationStatus";
import { folderLibraryHref } from "../lib/folder-links";

type Folder = {
  id: string;
  name?: string | null;
  total?: number;
  uniqueVideos?: number;
  sourceEntries?: number | null;
  lastFetchedAt?: string | null;
  lastProcessedAt?: string | null;
};

type Props = {
  folders: Folder[];
  localEntries?: number;
  uniqueVideos?: number;
  soundOnComplete?: boolean;
  soundOnError?: boolean;
};

export default function YouTubeFoldersPanel({ folders, localEntries, uniqueVideos, soundOnComplete, soundOnError }: Props) {
  const router = useRouter();
  const operation = useOperationObserver({ source: "yt", kind: "enrich", folders: true });
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const syncPlaylists = async () => {
    setSyncing(true);
    setMessage(null);
    setIsError(false);
    try {
      const res = await fetch("/api/youtube/folders/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "YouTube playlist sync failed");
      setMessage(`Synced ${json.total} playlists.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "YouTube playlist sync failed");
      setIsError(true);
    } finally {
      setSyncing(false);
    }
  };

  const processFolder = async (folderId: string) => {
    setProcessing(folderId);
    setMessage(null);
    setIsError(false);
    try {
      const run = await operation.submit(`/api/enrich?source=yt&folderId=${encodeURIComponent(folderId)}&full=true`);
      if (run) {
        if (soundOnComplete && run.status === "completed") playSuccessSound();
        if (soundOnError && run.failed > 0) playErrorSound();
        setMessage(operationMessage(run));
        setIsError(run.status !== "completed");
      } else setMessage("No playlist items need processing.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Playlist processing failed");
      setIsError(true);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-white/70 p-6 shadow-sm">
      <OperationStatus operation={operation} />
      {message ? (
        <div className={`rounded-lg p-3 text-sm font-semibold mb-2 shadow-sm border ${isError ? "bg-red-50 text-red-800 border-red-100" : "bg-emerald-50 text-emerald-800 border-emerald-100"}`}>
          {message}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <YouTubeLogo className="h-5 w-7" />
          Playlists
        </h2>
        <button
          type="button"
          title="Update playlist names only. This does not import, summarize, or index."
          onClick={syncPlaylists}
          disabled={syncing}
          className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-slate-800 transition disabled:opacity-60"
        >
          {syncing ? "Syncing…" : "Sync playlist names"}
        </button>
      </div>
      <p className="text-xs text-on-surface-variant">{localEntries ?? folders.reduce((total, folder) => total + (folder.total ?? 0), 0)} local playlist entries{uniqueVideos !== undefined ? ` · ${uniqueVideos} unique videos` : ""}. A video in multiple playlists has a separate local entry in each. Import fetches entries; Summarize creates digests; Index builds search vectors.</p>
      {folders.length ? (
        <div className="overflow-x-auto rounded-lg border border-black/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="px-4 py-2">Playlist Name</th>
                <th className="px-4 py-2">Local entries</th>
                <th className="px-4 py-2">Fetched</th>
                <th className="px-4 py-2">Summarized</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 bg-white">
              {folders.map((folder) => (
                <tr key={folder.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold">
                    <Link className="text-primary hover:underline" href={folderLibraryHref("yt", folder.id)}>{folder.name ?? "Unknown playlist"}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    <Link aria-label={`Open ${folder.total ?? 0} local entries in ${folder.name ?? "Unknown playlist"}`} className="text-primary hover:underline" href={folderLibraryHref("yt", folder.id)}>{folder.total ?? 0}</Link>
                    {folder.sourceEntries !== null && folder.sourceEntries !== undefined && <span className="block text-xs">{folder.sourceEntries} source playlist entries</span>}
                    {folder.uniqueVideos !== undefined && <span className="block text-xs">{folder.uniqueVideos} unique local videos</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {formatFolderActivity(folder.lastFetchedAt)}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {formatFolderActivity(folder.lastProcessedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => processFolder(folder.id)}
                      disabled={!!processing || operation.active || operation.submitting}
                      className="rounded-full border border-black/10 px-3 py-1 text-xs font-bold uppercase text-slate-700 transition hover:bg-black hover:text-white disabled:opacity-60"
                    >
                      {processing === folder.id ? "..." : "Summarize"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-600">No playlists yet. Sync to load them.</p>
      )}
    </section>
  );
}
