"use client";

import { useState } from "react";
import { useOperationObserver } from "../useOperationObserver";
import { operationMessage } from "../../lib/operation-observer";
import { useSettingsContext } from "./useSettingsContext";

export function useUsageSettings() {
  const { setMessage } = useSettingsContext();
  
  const [markingLatest, setMarkingLatest] = useState(false);
  const [resettingBaseline, setResettingBaseline] = useState(false);
  const operation = useOperationObserver({ kind: "embedding" });

  const markLatest = async () => {
    setMarkingLatest(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/mark-latest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Mark latest failed");
      setMessage("Marked latest X bookmark as the sync baseline.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mark latest failed");
    } finally {
      setMarkingLatest(false);
    }
  };

  const resetBaseline = async () => {
    setResettingBaseline(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/reset-baseline", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Reset failed");
      setMessage("Sync baseline reset. Next sync will fetch everything.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset failed");
    } finally {
      setResettingBaseline(false);
    }
  };

  const syncEmbeddings = async () => {
    setMessage(null);
    try {
      const run = await operation.submit("/api/bookmarks/embeddings/sync?full=true");
      setMessage(run ? operationMessage(run) : "No bookmarks need embedding sync.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sync failed"); }
  };

  return {
    markingLatest,
    resettingBaseline,
    syncingEmbeddings: operation.active || operation.submitting,
    operation,
    markLatest,
    resetBaseline,
    syncEmbeddings,
  };
}
