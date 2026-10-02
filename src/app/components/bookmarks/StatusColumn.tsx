import { readCapturedSource } from "@/lib/capture-contract";
type Props = { captureJson?: string | null; availability?: string | null; status: string; edited: boolean; read?: boolean; error?: string | null; failures?: number; sim?: number };
export function StatusColumn({ status, edited, read, error, failures = 0, sim, captureJson, availability }: Props) {
  const capture = status === "Summarized" ? readCapturedSource(captureJson) : null;
  return <span className="flex flex-col gap-0.5 text-xs">
    <span className={status === "Pending" ? "font-semibold text-secondary" : "font-semibold text-primary"}>{status}</span>
    {error && <span className="font-semibold text-error" title={error}>{failures >= 3 ? "Blocked" : "Failed"}</span>}
    {capture?.method === "description" && <span>Description only</span>}
    {capture?.capture.status === "partial" && <span>Partial source</span>}
    {availability && availability !== "available" && <span>Unavailable video</span>}
    {edited && <span className="text-on-surface-variant">Edited</span>}
    <span className="text-on-surface-variant">{read ? "Read" : "Unread"}</span>
    {sim !== undefined && <span className="font-semibold text-primary">{Math.round(sim * 100)}% match</span>}
  </span>;
}
