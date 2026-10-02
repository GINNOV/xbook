"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { playSuccessSound, playErrorSound } from "@/lib/audio";
import { useOperationObserver } from "./useOperationObserver";
import { operationMessage } from "../lib/operation-observer";

export interface Folder {
  id: string;
  name: string | null;
  total?: number;
  lastFetchedAt?: string | null;
  lastProcessedAt?: string | null;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? `Empty response from server (${res.status}). The request may have timed out — try again.`
        : `Server error ${res.status} ${res.statusText || ""}`.trim()
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid JSON from server (${res.status}): ${text.slice(0, 160).replace(/\s+/g, " ")}`
    );
  }
}

export function useFoldersPanel(folders: Folder[], soundOnComplete?: boolean, soundOnError?: boolean) {
  const router = useRouter();
  const operation = useOperationObserver({ source: "x", kind: "enrich", folders: true });
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [loading, setLoading] = useState({ syncing: false, all: false, importing: null as string | null, processing: null as string | null });

  const setLoad = (key: keyof typeof loading, val: string | boolean | null) => setLoading(prev => ({ ...prev, [key]: val }));
  const log = (text: string, isError = false) => setMsg({ text, isError });

  const syncFolders = async () => {
    setLoad("syncing", true); log("");
    try {
      const res = await fetch("/api/folders/sync", { method: "POST" });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error || "Sync failed");
      log(`Synced ${json.total} folders.`);
      router.refresh();
    } catch (e) {
      log(e instanceof Error ? e.message : String(e), true);
    } finally {
      setLoad("syncing", false);
    }
  };

  const importFolder = async (fid: string) => {
    setLoad("importing", fid); log("");
    try {
      const res = await fetch(`/api/folders/import?folderId=${fid}`, { method: "POST" });
      const json = await readJson(res);
      if (res.status === 409) throw new Error(json.error || "A sync is already in progress.");
      if (!res.ok) throw new Error(json.error || "Import failed");
      log(`Imported ${json.imported}. Refreshed ${json.refreshed}. X calls: ${json.pagesFetched}.`);
      router.refresh();
    } catch (e) {
      log(e instanceof Error ? e.message : String(e), true);
    } finally {
      setLoad("importing", null);
    }
  };

  const importAllFolders = async () => {
    if (!folders.length) return;
    setLoad("all", true); log("");
    try {
      let imp = 0, ref = 0, pgs = 0;
      for (const f of folders) {
        log(`Importing ${f.name || f.id}...`);
        const res = await fetch(`/api/folders/import?folderId=${encodeURIComponent(f.id)}`, { method: "POST" });
        const json = await readJson(res);
        if (res.status === 409) throw new Error(json.error || "A sync is already in progress.");
        if (!res.ok) throw new Error(`${f.name || f.id}: ${json.error}`);
        imp += Number(json.imported || 0); ref += Number(json.refreshed || 0); pgs += Number(json.pagesFetched || 0);
      }
      log(`Imported all: ${imp} new, ${ref} refreshed. X calls: ${pgs}.`);
      router.refresh();
    } catch (e) {
      log(e instanceof Error ? e.message : String(e), true);
    } finally {
      setLoad("all", false);
    }
  };

  const processFolder = async (fid: string) => {
    setLoad("processing", fid); log("");
    try {
      const run = await operation.submit(`/api/enrich?source=x&folderId=${encodeURIComponent(fid)}&full=true`);
      if (run) {
        if (soundOnComplete && run.status === "completed") playSuccessSound();
        if (soundOnError && run.failed > 0) playErrorSound();
        log(operationMessage(run), run.status !== "completed");
      } else log("No folder items need processing.");
      router.refresh();
    } catch (e) {
      log(e instanceof Error ? e.message : String(e), true);
    } finally {
      setLoad("processing", null);
    }
  };

  return { operation, msg, loading, syncFolders, importFolder, importAllFolders, processFolder };
}
