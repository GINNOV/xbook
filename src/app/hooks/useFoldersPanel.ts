"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { playSuccessSound, playErrorSound } from "@/lib/audio";
import { useOperationObserver } from "./useOperationObserver";
import { operationMessage } from "../lib/operation-observer";

export interface Folder {
  id: string;
  name: string | null;
  total?: number;
  uniqueVideos?: number;
  sourceEntries?: number | null;
  lastFetchedAt?: string | null;
  lastProcessedAt?: string | null;
}
const namesResponseSchema = z.object({ total: z.number().optional(), error: z.string().optional() });

export function useFoldersPanel(folders: Folder[], soundOnComplete?: boolean, soundOnError?: boolean, source: "x" | "yt" = "x") {
  const router = useRouter();
  const operation = useOperationObserver({ source });
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [loading, setLoading] = useState<{ syncing: boolean; all: boolean; importing: Folder["id"] | null; processing: Folder["id"] | null; indexing: Folder["id"] | null }>({ syncing: false, all: false, importing: null, processing: null, indexing: null });
  const setLoad = (key: keyof typeof loading, value: string | boolean | null) => setLoading((previous) => ({ ...previous, [key]: value }));
  const log = (text: string, isError = false) => setMsg({ text, isError });
  const syncFolders = async () => {
    setLoad("syncing", true); setMsg(null);
    try {
      const response = await fetch(source === "x" ? "/api/folders/sync" : "/api/youtube/folders/sync", { method: "POST" });
      const json = namesResponseSchema.parse(await response.json());
      if (!response.ok) throw new Error(json.error ?? "Name sync failed");
      log(`Synced ${json.total ?? 0} ${source === "x" ? "folder" : "playlist"} names. Existing imports and summaries are preserved.`);
      router.refresh();
    } catch (error) { log(error instanceof Error ? error.message : String(error), true); }
    finally { setLoad("syncing", false); }
  };
  const runAction = async (kind: "import" | "summarize" | "index", folderId?: string) => {
    const key = kind === "import" ? folderId ? "importing" : "all" : kind === "index" ? "indexing" : "processing";
    setLoad(key, folderId ?? true); setMsg(null);
    try {
      const scope = `source=${source}${folderId ? `&folderId=${encodeURIComponent(folderId)}` : "&all=true"}`;
      const url = kind === "import" ? `/api/folders/import?${scope}` : kind === "index" ? `/api/bookmarks/embeddings/sync?${scope}&full=true` : `/api/enrich?${scope}&full=true`;
      const run = await operation.submit(url);
      if (run) {
        if (soundOnComplete && run.status === "completed") playSuccessSound();
        if (soundOnError && ["failed", "partial", "paused"].includes(run.status)) playErrorSound();
        log(operationMessage(run), run.status !== "completed");
      } else {
        const folder = folders.find((candidate) => candidate.id === folderId);
        log(`No items need ${kind === "summarize" ? "summarizing" : kind === "index" ? "indexing" : "importing"}${folder ? ` in ${folder.name ?? "this folder"}` : ""}.`);
      }
      router.refresh();
    } catch (error) { log(error instanceof Error ? error.message : String(error), true); }
    finally { setLoad(key, key === "all" ? false : null); }
  };
  return { operation, msg, loading, syncFolders, importFolder: (id: string) => runAction("import", id), importAllFolders: () => runAction("import"), processFolder: (id: string) => runAction("summarize", id), indexFolder: (id: string) => runAction("index", id) };
}
