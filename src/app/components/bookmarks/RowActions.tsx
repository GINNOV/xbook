import type { Bookmark } from "../../hooks/useBookmarksList";
type Props = { b: Bookmark; busy: boolean; onToggleRead: (bookmark: Bookmark) => void; onEdit: (bookmark: Bookmark) => void };
export function RowActions({ b, busy, onToggleRead, onEdit }: Props) {
  const btn = "rounded-md bg-surface-container-high px-2 py-1 text-xs font-semibold disabled:opacity-60";
  return <span className="flex justify-end gap-2">
    <button type="button" disabled={busy} className={btn} aria-label={`Mark ${b.readAt ? "unread" : "read"}: ${b.summary || b.text || b.id}`} onClick={() => onToggleRead(b)}>{b.readAt ? "Unread" : "Read"}</button>
    <button type="button" className={btn} aria-label={`Edit enrichment: ${b.summary || b.text || b.id}`} onClick={() => onEdit(b)}>Edit</button>
  </span>;
}
