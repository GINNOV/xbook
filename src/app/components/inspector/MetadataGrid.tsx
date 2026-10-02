import type { Bookmark } from "../../hooks/useBookmarksList";
export function MetadataGrid({ b }: { b: Bookmark }) {
  const cell = (label: string, value: string) => <div className="min-w-0 rounded-md bg-surface-container-lowest p-3"><p className="text-xs uppercase text-on-surface-variant">{label}</p><p className="break-words font-semibold">{value}</p></div>;
  const author = b.authorUsername ? (b.source === "x" ? `@${b.authorUsername}` : b.authorUsername) : "Unknown";
  const processing = b.error ? (b.enrichmentFailures ?? 0) >= 3 ? "Blocked" : "Failed" : b.summary?.trim() ? "Summarized" : "Pending";
  return <div className="grid grid-cols-2 gap-3 text-sm">
    {cell(b.source === "yt" ? "Channel" : "Author", author)}{cell("Read state", b.readAt ? "Read" : "Unread")}
    {cell("Human edit", b.editedAt ? "Edited" : "No human edit")}{cell("Processing", processing)}
    {cell("Posted", b.createdAt ? new Date(b.createdAt).toLocaleString() : "Unknown")}{cell("Imported", b.importedAt ? new Date(b.importedAt).toLocaleString() : "Unknown")}
    {b.error && <p className="col-span-2 break-words text-error">Processing issue: {b.error}</p>}
  </div>;
}
