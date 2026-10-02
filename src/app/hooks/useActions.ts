"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { playSuccessSound, playErrorSound } from "@/lib/audio";
import { useOperationObserver } from "./useOperationObserver";
import { operationCheckpoint, operationMessage, operationProgress, type ObservedOperation } from "../lib/operation-observer";

const TOAST_KEY = "xbook:actions-toast";
const toastSchema = z.object({ message: z.string(), expiresAt: z.number() });

export function useActions(source: "x" | "yt", enrichBatchSize: number, soundOnComplete?: boolean, soundOnError?: boolean) {
  const router = useRouter();
  const operation = useOperationObserver({ source });
  const [loading, setLoading] = useState({ x: false, yt: false, enrichX: false, enrichYt: false, inboxX: false, inboxYt: false, embeddings: false });
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    sessionStorage.setItem(TOAST_KEY, JSON.stringify({ message: text, expiresAt: Date.now() + 4000 }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => {
    try {
      const cached = toastSchema.safeParse(JSON.parse(sessionStorage.getItem(TOAST_KEY) ?? "null"));
      if (cached.success && cached.data.expiresAt > Date.now()) {
        setToast(cached.data.message);
        timer.current = setTimeout(() => setToast(null), cached.data.expiresAt - Date.now());
      }
    } catch { sessionStorage.removeItem(TOAST_KEY); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => { if (operation.run) setMessage(operationMessage(operation.run)); }, [operation.run]);
  const setLoad = (key: keyof typeof loading, value: boolean) => setLoading((previous) => ({ ...previous, [key]: value }));
  const finish = (run: ObservedOperation) => {
    if (soundOnComplete && run.status === "completed" && run.updated > 0) playSuccessSound();
    if (soundOnError && ["failed", "partial", "paused"].includes(run.status)) playErrorSound();
    showToast(run.status === "completed" ? "Processing finished." : `Operation ${run.status}.`);
    router.refresh();
  };
  const runImport = async () => {
    setLoad(source, true); setMessage("Submitting import…");
    try {
      const run = await operation.submit(`/api/import?source=${source}`);
      if (run) { finish(run); return run; }
      setMessage("No new items to import.");
      return null;
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return null; }
    finally { setLoad(source, false); }
  };
  const runEnrich = async (full = false, reprocess = false) => {
    const key = source === "x" ? "enrichX" : "enrichYt";
    setLoad(key, true); setMessage("Submitting enrichment…");
    try {
      const run = await operation.submit(`/api/enrich?source=${source}&limit=${source === "yt" ? 200 : enrichBatchSize}&full=${full}&reprocess=${reprocess}`);
      if (!run) { setMessage("No bookmarks need enrichment."); return null; }
      finish(run);
      return { totalUpdated: run.updated, totalProcessed: run.processed, remaining: operationProgress(run).remaining, errorsCount: run.failed, stopped: run.status === "stopped" };
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return null; }
    finally { setLoad(key, false); }
  };
  const runProcessInbox = async () => {
    const key = source === "x" ? "inboxX" : "inboxYt";
    setLoad(key, true); setMessage("Submitting inbox processing…");
    try {
      const run = await operation.submit(`/api/import?source=${source}&pipeline=true`);
      if (run) finish(run);
      else setMessage("No inbox items need processing.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoad(key, false); }
  };
  const progressRef = useRef<((progress: { done: number; failed: number; remaining: number; target: number }) => void) | undefined>(undefined);
  useEffect(() => {
    if (operation.run?.type !== "embedding_sync") return;
    const progress = operationProgress(operation.run);
    progressRef.current?.({ done: progress.updated, failed: progress.failed, remaining: progress.remaining, target: progress.total });
  }, [operation.run]);
  const runSyncEmbeddings = async (options?: {
    source?: "x" | "yt" | null;
    rebuild?: boolean;
    onProgress?: (progress: { done: number; failed: number; remaining: number; target: number }) => void;
  }) => {
    progressRef.current = options?.onProgress;
    setLoad("embeddings", true); setMessage("Submitting embedding sync…");
    try {
      const run = await operation.submit(`/api/bookmarks/embeddings/sync?full=true${options?.source ? `&source=${options.source}` : ""}${options?.rebuild ? "&rebuild=true" : ""}`);
      if (!run) { setMessage("No bookmarks need embedding sync."); return null; }
      finish(run);
      const progress = operationProgress(run);
      return { totalUpdated: progress.updated, totalFailed: progress.failed, remaining: progress.remaining, target: progress.total };
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return null; }
    finally { setLoad("embeddings", false); }
  };
  const kind = operation.run && operationCheckpoint(operation.run)?.kind;
  const importing = operation.active && (kind === "import" || operation.run?.type === "import");
  const embedding = operation.active && kind === "embedding";
  const inbox = importing && Boolean(operation.run && operationCheckpoint(operation.run)?.import?.pipeline);
  const enriching = operation.active && kind === "enrich";
  return {
    loading: { ...loading, inboxX: loading.inboxX || (source === "x" && inbox), inboxYt: loading.inboxYt || (source === "yt" && inbox), x: loading.x || (source === "x" && importing), yt: loading.yt || (source === "yt" && importing),
      enrichX: loading.enrichX || (source === "x" && enriching), enrichYt: loading.enrichYt || (source === "yt" && enriching), embeddings: loading.embeddings || embedding },
    operation, message, toast, cancelling: operation.controlling,
    runImport, runEnrich, runProcessInbox, runSyncEmbeddings, cancelOperation: operation.stop,
  };
}
