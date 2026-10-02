"use client";

import { Bookmark } from "../hooks/useBookmarksList";
import { SourceIcon } from "./bookmarks/SourceIcon";
import { StatusColumn } from "./bookmarks/StatusColumn";
import { RowActions } from "./bookmarks/RowActions";

export const LIBRARY_ROW_GRID =
  "grid-cols-[44px_minmax(220px,1fr)_150px_150px_100px_90px_90px_140px]";

type Props = {
  bookmark: Bookmark; isSelected: boolean; onSelect: (id: string) => void;
  onToggleRead: (bookmark: Bookmark) => void; onEdit: (bookmark: Bookmark) => void;
  isBusy: boolean; getYouTubeTitle: (bookmark: Bookmark) => string | null; getYouTubeFolder: (bookmark: Bookmark) => string | null;
};

export function BookmarkRow({ bookmark: b, isSelected, onSelect, onToggleRead, onEdit, isBusy, getYouTubeTitle, getYouTubeFolder }: Props) {
  const title = getYouTubeTitle(b) || b.summary || b.text || "Untitled";
  const author = b.authorUsername ? (b.source === "x" ? `@${b.authorUsername}` : b.authorUsername) : "Unknown";
  // Match library status filters / dashboard: pending = empty summary only.
  // Category alone (e.g. stub "Other") is still pending enrichment.
  const status = b.summary?.trim() ? "Summarized" : "Pending";
  const fmt = (d?: Date | string | null) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : "-";

  return (
    <div      className={`grid min-w-[1050px] w-full ${LIBRARY_ROW_GRID} px-4 py-3 text-left text-sm transition hover:bg-surface-container-low ${isSelected ? "shadow-[inset_4px_0_0_var(--primary)]" : ""} ${b.readAt ? "opacity-70" : ""}`}>
      <SourceIcon source={b.source} />
      <button type="button" data-bookmark-reader={b.id} aria-label={`Read bookmark: ${title}`} aria-expanded={isSelected} onClick={() => onSelect(b.id)} className="min-w-0 truncate text-left font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{title}</button>
      <span className="truncate text-on-surface-variant">{author}</span>
      <span className="truncate text-on-surface-variant">{getYouTubeFolder(b) || b.folderName || "No folder"}</span>
      <StatusColumn captureJson={b.captureJson} availability={b.availability} status={status} edited={!!b.editedAt} read={!!b.readAt} error={b.error} failures={b.enrichmentFailures} sim={b.similarity} />
      <span className="text-xs text-on-surface-variant">{fmt(b.createdAt)}</span>
      <span className="text-xs text-on-surface-variant">{fmt(b.importedAt)}</span>
      <RowActions b={b} busy={isBusy} onToggleRead={onToggleRead} onEdit={onEdit} />
    </div>
  );
}
