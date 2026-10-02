"use client";

import { resolveRunStatus } from "@/lib/run-outcome";

import { useState } from "react";
import Link from "next/link";
import { XLogo, YouTubeLogo, CloseIcon, SearchIcon } from "../Icons";
import StopRunButton from "../StopRunButton";
import { useOperationObserver } from "../../hooks/useOperationObserver";
import OperationStatus from "../OperationStatus";
import { operationCheckpoint, operationRunSchema } from "../../lib/operation-observer";

function RunRecovery({ runId }: { runId: string }) {
  const operation = useOperationObserver({ initialRunId: runId });
  return <OperationStatus operation={operation} />;
}
import { ProcessingEvents } from "./ProcessingEvents";
import { statusClass } from "@/app/lib/formatters";
import { getFilterUrl } from "@/app/lib/processing-utils";
import { formatRunConfig, resolveRunConfig } from "@/lib/run-config";

type Props = {
  selectedRun: any;
  currentParams: any;
};

export function RunDetails({ selectedRun, currentParams }: Props) {
  const [search, setSearch] = useState("");
  if (!selectedRun) return <p className="text-sm text-on-surface-variant">Select a run to inspect events.</p>;

  const snapshot = operationRunSchema.safeParse(selectedRun);
  const importing = snapshot.success ? operationCheckpoint(snapshot.data)?.import : null;
  const metrics = importing ? [
    { label: "New entries", value: importing.imported }, { label: "Refreshed entries", value: importing.refreshed },
    { label: "Skipped", value: importing.skipped }, { label: "Unavailable", value: importing.unavailable },
    { label: "Pages fetched", value: importing.pagesFetched }, { label: "Folders finished", value: importing.foldersCompleted },
    { label: "Folders failed", value: importing.foldersFailed }, { label: "Summarized", value: importing.enriched }, { label: "Indexed", value: importing.indexed },
  ] : [
    { label: "Processed", value: selectedRun.processed }, { label: "Updated", value: selectedRun.updated },
    { label: "Failed", value: selectedRun.failed }, { label: "Skipped", value: selectedRun.skipped },
  ];
  const configLine = formatRunConfig(
    resolveRunConfig({
      configJson: selectedRun.configJson,
      llmModel: selectedRun.llmRequests?.[0]?.model,
      llmBaseUrl: selectedRun.llmRequests?.[0]?.baseUrl,
      notes: selectedRun.notes,
    })
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-6 border-b border-outline-variant/30 pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-high shadow-sm">
              {selectedRun.source === "yt" ? <YouTubeLogo className="h-4 w-5" /> : <XLogo className="h-4 w-4" />}
            </span>
            <h2 className="font-headline text-3xl font-semibold tracking-tight capitalize">{selectedRun.type.replaceAll("_", " ")}</h2>
            <div className="ml-2 flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusClass(resolveRunStatus(selectedRun))} bg-opacity-10 border border-current`}>
                {resolveRunStatus(selectedRun)}
              </span>
              {configLine ? (
                <span
                  className="rounded bg-surface-container-high px-2 py-0.5 text-[10px] font-medium text-on-surface-variant tracking-tight font-mono max-w-[min(42rem,50vw)] truncate"
                  title={configLine}
                >
                  {configLine}
                </span>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-on-surface-variant ml-11">{selectedRun.notes || "Processing batch details and event history."}</p>
        </div>

        <div className="flex items-center gap-6">
          <div className="relative flex-1 min-w-[300px] md:min-w-[450px]">
            <SearchIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant opacity-60" />
            <input
              type="text"
              placeholder="Search by tweet text, author, message or status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-full border border-outline-variant/40 bg-surface-container-lowest pl-11 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            {!selectedRun.jobJson && (selectedRun.status === "running" || selectedRun.status === "queued") && <StopRunButton runId={selectedRun.id} />}
            <Link 
              href={getFilterUrl(currentParams, { runId: null })} 
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high hover:bg-surface-container-highest transition-colors shadow-sm"
              title="Close details"
            >
              <CloseIcon className="h-5 w-5 opacity-60" />
            </Link>
          </div>
        </div>
      </header>

      {selectedRun.jobJson && <RunRecovery key={selectedRun.id} runId={selectedRun.id} />}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {metrics.map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1 rounded-xl bg-surface-container-lowest p-5 border border-outline-variant/20 shadow-sm">
            <dt className="text-xs font-semibold text-on-surface-variant">{label}</dt>
            <dd className={`text-2xl font-semibold tabular-nums ${label.includes("failed") || label === "Failed" ? "text-error" : ""}`}>{value}</dd>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-10">
        <ProcessingEvents 
          events={selectedRun.events} 
          requests={selectedRun.llmRequests} 
          search={search} 
        />
      </div>
    </div>
  );
}
