"use client";

import Link from "next/link";
import type { useOperationObserver } from "../hooks/useOperationObserver";
import { operationCheckpoint, operationMessage, operationProgress } from "../lib/operation-observer";

type Props = { operation: ReturnType<typeof useOperationObserver> };
export default function OperationStatus({ operation }: Props) {
  const { run, active, controlling, connectionError, stop, resume } = operation;
  if (!run && !connectionError) return null;
  const progress = run && operationProgress(run);
  const canResume = run && operationCheckpoint(run) && ["paused", "stopped", "failed", "partial"].includes(run.status);
  return <div className="rounded-xl border border-outline-variant/30 p-3 text-sm" aria-live="polite">
    {run && <p>{operationMessage(run)}</p>}
    {connectionError && <p role="alert" className="text-error">{connectionError}</p>}
    {active && <p className="text-xs text-on-surface-variant">Work continues on the server when you leave this page.</p>}
    <div className="mt-2 flex flex-wrap gap-3">
      {!run && connectionError && <Link className="text-primary underline" href="/processing">View processing</Link>}
      {run && <Link className="text-primary underline" href={`/processing?runId=${encodeURIComponent(run.id)}`}>View operation</Link>}
      {progress?.repairAction && <Link className="text-primary underline" href={progress.repairAction}>Repair settings</Link>}
      {canResume && <button type="button" disabled={controlling} onClick={() => void resume()} className="text-primary underline">Resume operation</button>}
      {active && <button type="button" disabled={controlling} onClick={() => void stop()} className="text-error underline">Stop operation</button>}
    </div>
  </div>;
}
