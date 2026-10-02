"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { playSuccessSound, playErrorSound } from "@/lib/audio";
import { useOperationObserver } from "./useOperationObserver";
import { operationMessage, operationProgress } from "../lib/operation-observer";

const TOAST_KEY = "xbook:actions-toast";

function isAbortError(e: unknown) {
  return e instanceof DOMException
    ? e.name === "AbortError"
    : e instanceof Error && e.name === "AbortError";
}

/** Parse JSON without throwing the opaque "Unexpected end of JSON input" on empty bodies. */
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

type FetchJsonOptions = {
  method?: string;
  signal?: AbortSignal;
  /** Transient empty/timeout bodies are retried this many extra times. */
  retries?: number;
};

async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<{ res: Response; json: any }> {
  const retries = options.retries ?? 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetch(url, { method: options.method ?? "GET", signal: options.signal });
      const json = await readJson(res);
      return { res, json };
    } catch (e) {
      if (isAbortError(e)) throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
      const retriable =
        /Empty response|timed out|Failed to fetch|NetworkError|network/i.test(lastError.message) ||
        /Invalid JSON/i.test(lastError.message);
      if (!retriable || attempt === retries) throw lastError;
      // Brief backoff before retrying a flaky long request.
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error("Request failed");
}

export function useActions(source: "x" | "yt", enrichBatchSize: number, soundOnComplete?: boolean, soundOnError?: boolean) {
  const router = useRouter();
  const operation = useOperationObserver({ source });
  const [loading, setLoading] = useState({
    x: false,
    yt: false,
    enrichX: false,
    enrichYt: false,
    inboxX: false,
    inboxYt: false,
    embeddings: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  /** Cancels the legacy import request. Durable processing is stopped by run ID. */
  const abortRef = useRef<AbortController | null>(null);
  /** Server operation run to stop when the user cancels. */
  const activeRunIdRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    sessionStorage.setItem(TOAST_KEY, JSON.stringify({ message: msg, expiresAt: Date.now() + 4000 }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem(TOAST_KEY);
    if (!raw) return;
    const { message, expiresAt } = JSON.parse(raw);
    const rem = expiresAt - Date.now();
    if (rem > 0) {
      setToast(message);
      timer.current = setTimeout(() => setToast(null), rem);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const setLoad = (key: keyof typeof loading, val: boolean) => setLoading((prev) => ({ ...prev, [key]: val }));

  const beginClientOp = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    activeRunIdRef.current = null;
    return controller;
  };

  const endClientOp = (controller: AbortController) => {
    if (abortRef.current === controller) {
      abortRef.current = null;
      activeRunIdRef.current = null;
    }
  };

  const trackRunId = (runId?: string | null) => {
    if (runId) activeRunIdRef.current = runId;
  };

  const cancelOperation = async () => {
    setCancelling(true);
    try {
      if (operation.active) await operation.stop();
      else if (activeRunIdRef.current) await fetch(`/api/processing/runs/${activeRunIdRef.current}`, { method: "POST" });
      abortRef.current?.abort();
    } finally { setCancelling(false); }
  };

  useEffect(() => {
    if (operation.run) setMessage(operationMessage(operation.run));
  }, [operation.run]);

  const runImport = async () => {
    const controller = beginClientOp();
    setLoad(source, true);
    setMessage(null);
    try {
      const { res, json } = await fetchJson(`/api/import?source=${source}`, {
        method: "POST",
        signal: controller.signal,
        retries: 1,
      });
      if (res.status === 409) throw new Error(json.error || "A sync is already in progress.");
      if (!res.ok) throw new Error(json.error || "Import failed");
      if (json.operationId || json.runId) trackRunId(json.operationId ?? json.runId);
      setMessage(
        json.message ||
          (json.imported
            ? `Imported ${json.imported} new item${json.imported === 1 ? "" : "s"}.`
            : "No new items.")
      );
      if (soundOnComplete && (json.imported ?? 0) > 0) playSuccessSound();
      router.refresh();
      return json;
    } catch (e) {
      if (isAbortError(e)) {
        setMessage("Stopped.");
        showToast("Operation stopped.");
        router.refresh();
        return null;
      }
      setMessage(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoad(source, false);
      endClientOp(controller);
    }
  };

  const runEnrich = async (full = false, reprocess = false) => {
    const key = source === "x" ? "enrichX" : "enrichYt";
    setLoad(key, true);
    setMessage("Submitting enrichment…");
    try {
      const run = await operation.submit(`/api/enrich?source=${source}&limit=${source === "yt" ? 200 : enrichBatchSize}&full=${full}&reprocess=${reprocess}`);
      if (!run) { setMessage("No bookmarks need enrichment."); return null; }
      if (soundOnComplete && run.status === "completed" && run.updated > 0) playSuccessSound();
      if (soundOnError && run.failed > 0) playErrorSound();
      showToast(run.status === "completed" ? "Processing finished." : `Operation ${run.status}.`);
      router.refresh();
      return { totalUpdated: run.updated, totalProcessed: run.processed, remaining: operationProgress(run).remaining, errorsCount: run.failed, stopped: run.status === "stopped" };
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return null; }
    finally { setLoad(key, false); }
  };

  /** Delta import then enrich all pending for this source, then best-effort embeddings. */
  const runProcessInbox = async () => {
    const key = source === "x" ? "inboxX" : "inboxYt";
    const controller = beginClientOp();
    setLoad(key, true);
    setMessage("Processing inbox: syncing…");
    try {
      let imported = 0;
      let importWarning: string | null = null;

      try {
        const { res, json } = await fetchJson(`/api/import?source=${source}`, {
          method: "POST",
          signal: controller.signal,
          retries: 1,
        });
        if (res.status === 409) throw new Error(json.error || "A sync is already in progress.");
        if (!res.ok) throw new Error(json.error || "Import failed");
        if (json.operationId || json.runId) trackRunId(json.operationId ?? json.runId);
        imported = json.imported ?? json.created ?? 0;
      } catch (e) {
        if (isAbortError(e)) throw e;
        // Keep going into enrich so existing pending items still get processed
        // when sync returns an empty/timeout body (common on long X imports).
        importWarning = e instanceof Error ? e.message : String(e);
        setMessage(`Sync issue (${importWarning}). Continuing with enrichment of existing pending…`);
      }

      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

      if (!importWarning) {
        setMessage(`Sync done (${imported} new). Enriching pending…`);
      }

      const enrichment = await operation.submit(`/api/enrich?source=${source}&full=true`);
      if (enrichment && enrichment.status !== "completed") { router.refresh(); return; }
      const totalUpdated = enrichment?.updated ?? 0;
      const totalProcessed = enrichment?.processed ?? 0;
      const remaining = enrichment ? operationProgress(enrichment).remaining : 0;
      const errorsCount = enrichment?.failed ?? 0;
      if (!mountedRef.current || controller.signal.aborted) return;
      const embedding = await operation.submit(`/api/bookmarks/embeddings/sync?source=${source}&full=true`);
      const embedMsg = embedding ? ` Indexed ${embedding.updated}. Failed: ${embedding.failed}.` : "";

      if (soundOnComplete && (totalProcessed > 0 || imported > 0)) playSuccessSound();
      const warn = importWarning ? ` Sync warning: ${importWarning}.` : "";
      const sum = `Inbox: ${imported} new · enriched ${totalUpdated}/${totalProcessed} · remaining ${remaining} · errors ${errorsCount}.${embedMsg}${warn}`;
      setMessage(sum);
      showToast(
        remaining > 0
          ? "Inbox finished with items still pending."
          : "Inbox processing finished."
      );
      router.refresh();
    } catch (e) {
      if (isAbortError(e)) {
        setMessage("Stopped.");
        showToast("Operation stopped.");
        router.refresh();
        return;
      }
      if (soundOnError) playErrorSound();
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoad(key, false);
      endClientOp(controller);
    }
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
    setLoad("embeddings", true);
    setMessage("Submitting embedding sync…");
    try {
      const run = await operation.submit(`/api/bookmarks/embeddings/sync?full=true${options?.source ? `&source=${options.source}` : ""}${options?.rebuild ? "&rebuild=true" : ""}`);
      if (!run) { setMessage("No bookmarks need embedding sync."); return null; }
      const progress = operationProgress(run);
      if (soundOnComplete && run.status === "completed" && run.updated > 0) playSuccessSound();
      if (soundOnError && run.failed > 0) playErrorSound();
      router.refresh();
      return { totalUpdated: progress.updated, totalFailed: progress.failed, remaining: progress.remaining, target: progress.total };
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return null; }
    finally { setLoad("embeddings", false); }
  };


  return {
    loading: { ...loading, enrichX: loading.enrichX || (source === "x" && operation.active && operation.run?.type !== "embedding_sync"), enrichYt: loading.enrichYt || (source === "yt" && operation.active && operation.run?.type !== "embedding_sync"), embeddings: loading.embeddings || (operation.active && operation.run?.type === "embedding_sync") },
    operation,
    message,
    toast,
    cancelling,
    runImport,
    runEnrich,
    runProcessInbox,
    runSyncEmbeddings,
    cancelOperation,
  };
}
