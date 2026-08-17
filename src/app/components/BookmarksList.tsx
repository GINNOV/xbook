"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useBookmarksList, Bookmark } from "../hooks/useBookmarksList";
import { BookmarkRow, LIBRARY_ROW_GRID } from "./BookmarkRow";
import { BookmarkInspector } from "./BookmarkInspector";
import { EditEnrichmentDialog } from "./EditEnrichmentDialog";
import {
  type BookmarkSortKey,
  type SortDir,
  defaultDirForSort,
} from "@/lib/bookmark-sort";

type Props = {
  initial: Bookmark[];
  sort: BookmarkSortKey;
  dir: SortDir;
  source: string;
};

function SortHeader({
  column,
  label,
  sort,
  dir,
}: {
  column: BookmarkSortKey;
  label: string;
  sort: BookmarkSortKey;
  dir: SortDir;
}) {
  const searchParams = useSearchParams();
  const active = sort === column;
  const nextDir = active ? (dir === "asc" ? "desc" : "asc") : defaultDirForSort(column);
  const params = new URLSearchParams(searchParams.toString());
  params.set("sort", column);
  params.set("dir", nextDir);
  params.delete("page");
  const href = `/bookmarks?${params.toString()}`;

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 uppercase transition hover:text-on-surface ${
        active ? "text-on-surface" : ""
      }`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {active ? (
        <span aria-hidden className="text-[10px] leading-none">
          {dir === "asc" ? "▲" : "▼"}
        </span>
      ) : null}
    </Link>
  );
}

export default function BookmarksList({ initial, sort, dir, source }: Props) {
  const {
    items,
    busyId,
    message,
    editing,
    setEditing,
    selectedId,
    setSelectedId,
    translatedText,
    isTranslating,
    translate,
    reprocess,
    toggleRead,
    openEdit,
    closeEdit,
    saveEdit,
    selected,
  } = useBookmarksList(initial);

  const getYouTubeTitle = (bookmark: Bookmark) => {
    if (bookmark.source !== "yt") return null;
    try {
      const parsed = JSON.parse(bookmark.rawJson ?? "{}") as {
        item?: { snippet?: { title?: string } };
      };
      const byJson = parsed.item?.snippet?.title?.trim();
      if (byJson) return byJson;
    } catch {}
    const byText = bookmark.text?.split("\n")[0]?.trim();
    return byText || null;
  };

  const getYouTubeFolder = (bookmark: Bookmark) => {
    if (bookmark.source !== "yt") return bookmark.folderName ?? null;
    if (bookmark.folderName?.trim()) return bookmark.folderName.trim();
    try {
      const parsed = JSON.parse(bookmark.rawJson ?? "{}") as {
        playlistTitle?: string;
      };
      return parsed.playlistTitle?.trim() ?? null;
    } catch {
      return null;
    }
  };

  const isYouTube = source === "yt" || items[0]?.source === "yt";

  return (
    <div className="flex flex-col gap-4">
      {message ? <p className="text-sm text-on-surface-variant">{message}</p> : null}
      <section className={`grid gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-1"}`}>
        <div className="overflow-x-auto rounded-lg bg-surface-container-lowest border border-outline-variant/30">
          <div className="min-w-[1050px]">
            <div className={`grid min-w-[1050px] ${LIBRARY_ROW_GRID} bg-surface-container px-4 py-2 text-xs font-semibold uppercase text-on-surface-variant`}>
              <span></span>
              <SortHeader column="summary" label={isYouTube ? "Video / digest" : "Summary"} sort={sort} dir={dir} />
              <SortHeader column="author" label={isYouTube ? "Channel" : "Author"} sort={sort} dir={dir} />
              <SortHeader column="folder" label="Folder" sort={sort} dir={dir} />
              <span>Status</span>
              <SortHeader column="posted" label="Posted" sort={sort} dir={dir} />
              <SortHeader column="import" label="Import" sort={sort} dir={dir} />
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-[color-mix(in_srgb,var(--outline-variant)_25%,transparent)]">
              {items.map((bookmark) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  isSelected={selectedId === bookmark.id}
                  onSelect={setSelectedId}
                  onToggleRead={toggleRead}
                  onEdit={openEdit}
                  isBusy={busyId === bookmark.id}
                  getYouTubeTitle={getYouTubeTitle}
                  getYouTubeFolder={getYouTubeFolder}
                />
              ))}
              {items.length === 0 ? (
                <p className="px-4 py-8 text-sm text-on-surface-variant">
                  No bookmarks match the current filters.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {selected && (
          <BookmarkInspector
            selected={selected}
            translatedText={translatedText}
            isTranslating={isTranslating}
            busyId={busyId}
            onTranslate={translate}
            onReprocess={reprocess}
            onEdit={openEdit}
            onClose={() => setSelectedId(null)}
            getYouTubeTitle={getYouTubeTitle}
          />
        )}
      </section>

      <EditEnrichmentDialog
        editing={editing}
        onClose={closeEdit}
        onSave={saveEdit}
        setEditing={setEditing}
        isBusy={busyId === editing?.id}
      />
    </div>
  );
}
