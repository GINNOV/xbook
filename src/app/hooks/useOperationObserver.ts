"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { operationActive, operationCheckpoint, operationRunSchema, readOperationResponse, type ObservedOperation } from "../lib/operation-observer";

type Scope = { discover?: boolean; initialRunId?: string; source?: "x" | "yt" | null; kind?: "enrich" | "embedding"; folders?: boolean };
export function useOperationObserver({ discover = true, initialRunId, source, kind, folders = false }: Scope = {}) {
  const [run, setRun] = useState<ObservedOperation | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [controlling, setControlling] = useState(false);
  const waiter = useRef<((run: ObservedOperation | null) => void) | null>(null);
  const storageKey = `xbook:operation:${initialRunId ?? "scope"}:${source ?? "all"}:${kind ?? "all"}:${folders}`;
  const mounted = useRef(false);
  const submitted = useRef(false);
  const apply = useCallback((next: ObservedOperation) => {
    setRun(next);
    setConnectionError(null);
    if (next.status === "completed") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, next.id);
    if (!operationActive(next)) { waiter.current?.(next); waiter.current = null; }
  }, [storageKey]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function reconnect() {
      try {
        if (!initialRunId) {
          const response = await fetch(`/api/processing/runs?take=50${source ? `&source=${source}` : ""}`, { signal: controller.signal });
          if (!response.ok) throw new Error(`Processing unavailable (${response.status}).`);
          const json = z.object({ runs: z.array(operationRunSchema) }).parse(await response.json());
          if (!controller.signal.aborted && !submitted.current) setConnectionError(null);
          const active = json.runs.find((candidate) => {
            const checkpoint = operationCheckpoint(candidate);
            return checkpoint && (!kind || checkpoint.kind === kind) && Boolean(checkpoint.scope.folderId) === folders && (operationActive(candidate) || candidate.status === "paused");
          });
          if (active && mounted.current && !submitted.current) { apply(active); return; }
        }
        const saved = initialRunId ?? localStorage.getItem(storageKey);
        if (saved) {
          const response = await fetch(`/api/processing/runs/${encodeURIComponent(saved)}`, { signal: controller.signal });
          if (response.ok) {
            const json = await readOperationResponse(response);
            if (json.run && !submitted.current && !controller.signal.aborted) { apply(json.run); return; }
          }
          if (!submitted.current) localStorage.removeItem(storageKey);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setConnectionError(`Unable to reconnect to processing. Retrying automatically. ${error instanceof Error ? error.message : ""}`);
          retry = setTimeout(reconnect, 1000);
        }
      }
    }
    if (discover || initialRunId) void reconnect();
    return () => { mounted.current = false; controller.abort(); clearTimeout(retry); waiter.current?.(null); waiter.current = null; };
  }, [apply, source, kind, folders, storageKey, initialRunId, discover]);

  const runId = run?.id;
  const active = operationActive(run);
  useEffect(() => {
    if (!runId || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/processing/runs/${encodeURIComponent(runId ?? "")}`, { signal: controller.signal });
        if (response.status === 404 && !controller.signal.aborted) {
          localStorage.removeItem(storageKey); setRun(null);
          setConnectionError("This operation was removed. Open Processing to review available runs.");
          waiter.current?.(null); waiter.current = null;
          return;
        }
        const json = await readOperationResponse(response);
        if (json.run && !controller.signal.aborted) apply(json.run);
      } catch (error) {
        if (!controller.signal.aborted) setConnectionError(`Connection lost. Reconnecting automatically. ${error instanceof Error ? error.message : ""}`);
      } finally { if (!controller.signal.aborted) timer = setTimeout(poll, 1000); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, active, apply, storageKey]);

  const submit = useCallback(async (url: string) => {
    submitted.current = true;
    setSubmitting(true); setConnectionError(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });
      const json = await readOperationResponse(response);
      if (!json.runId && !json.run) { setRun(null); localStorage.removeItem(storageKey); return null; }
      const detail = json.run ?? operationRunSchema.parse({
        id: json.runId, source: json.source ?? source ?? null,
        type: url.includes("/embeddings/") ? "embedding_sync" : "enrichment",
        status: "queued", total: json.processed + json.remaining,
        processed: json.processed, updated: json.updated, failed: json.failed, skipped: json.skipped,
      });
      if (!mounted.current) return null;
      if (!operationActive(detail)) { apply(detail); return detail; }
      const completion = new Promise<ObservedOperation | null>((resolve) => { waiter.current?.(null); waiter.current = resolve; });
      apply(detail);
      return await completion;
    } catch (error) {
      if (mounted.current) setConnectionError(error instanceof Error ? error.message : "Unable to submit. Open Processing to check whether the server accepted this operation.");
      throw error;
    } finally { if (mounted.current) setSubmitting(false); }
  }, [apply, storageKey, source]);

  const control = useCallback(async (action: "stop" | "resume") => {
    if (!run) return;
    setControlling(true);
    try {
      const json = await readOperationResponse(await fetch(`/api/processing/runs/${encodeURIComponent(run.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      }));
      if (json.run) apply(json.run);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "Operation control failed."); }
    finally { setControlling(false); }
  }, [run, apply]);
  return { run, active, submitting, controlling, connectionError, submit, stop: () => control("stop"), resume: () => control("resume") };
}
