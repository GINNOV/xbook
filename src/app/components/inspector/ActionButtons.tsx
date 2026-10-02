import { XLogo, YouTubeLogo } from "../Icons";
import { Bookmark } from "../../hooks/useBookmarksList";

type Props = { reading: boolean; onToggleRead: (bookmark: Bookmark) => void; b: Bookmark; busy: boolean; translating: boolean; onReprocess: (id: string, replaceEdited?: boolean) => void; onEdit: (bookmark: Bookmark) => void; onTranslate: (id: string) => void; };

export function ActionButtons({ b, busy, translating, onReprocess, onEdit, onTranslate, reading, onToggleRead }: Props) {
  const btn = "rounded-md bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface disabled:opacity-60 transition-colors";
  return (
    <div className="grid gap-2">
      <a href={b.tweetUrl} target="_blank" rel="noreferrer" className="rounded-md bg-primary px-4 py-2 text-center text-sm font-semibold text-white flex items-center justify-center gap-2 hover:bg-primary-strong">
        {b.source === "yt" ? <YouTubeLogo className="h-3 w-4 fill-white" /> : <XLogo className="h-3 w-3" />} Open original
      </a>
      <button onClick={() => onReprocess(b.id)} disabled={busy} className={btn}>{busy ? "Reprocessing..." : "Reprocess with LLM"}</button>
      {b.editedAt && <button onClick={() => { if (window.confirm("Replace this human correction with a new generated summary? Your existing source and read state will remain saved.")) onReprocess(b.id, true); }} disabled={busy} className={btn}>Replace human correction</button>}
      <button onClick={() => onToggleRead(b)} disabled={reading} className={btn}>{reading ? "Saving read state..." : b.readAt ? "Mark unread" : "Mark read"}</button>
      <button onClick={() => onEdit(b)} className={btn}>Edit enrichment</button>
      <button onClick={() => onTranslate(b.id)} disabled={translating || busy} className={btn}>{translating ? "Translating..." : "Translate"}</button>
    </div>
  );
}
