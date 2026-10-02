import type { BookmarkFeedback } from "../hooks/useBookmarksList";
export function BookmarkActionFeedback({ feedback }: { feedback: BookmarkFeedback[] }) {
  return <div className="space-y-2">{feedback.map((entry) => <div key={`${entry.id}:${entry.action}`} role={entry.error ? "alert" : "status"} className={`text-sm ${entry.error ? "text-error" : "text-on-surface-variant"}`}>
    <p>{entry.text}</p>{entry.retry && <button type="button" onClick={() => void entry.retry?.()} className="mt-1 rounded-md border border-outline-variant px-3 py-1 font-semibold">Retry {entry.action === "reprocess" ? "reprocessing" : entry.action === "read" ? "read update" : entry.action === "translate" ? "translation" : "edit"}</button>}
  </div>)}</div>;
}
