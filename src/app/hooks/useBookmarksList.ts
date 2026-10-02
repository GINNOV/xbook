"use client";

import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useOperationObserver } from "./useOperationObserver";

export type Bookmark = {
  id: string; source: string; tweetUrl: string; rawJson?: string | null; captureJson?: string | null;
  summarySource?: string | null; availability?: string | null; text: string | null; folderName?: string | null;
  summary: string | null; category: string | null; tags: string | null; authorUsername: string | null;
  importedAt: string | null; createdAt: string | null; summarizedAt: string | null; editedAt: string | null; readAt: string | null;
  error?: string | null; enrichmentFailures?: number; indexState?: string; similarity?: number;
};
export type EditState = { id: string; summary: string; category: string; tags: string } | null;
type Action = "translate" | "read" | "edit" | "reprocess";
export type BookmarkFeedback = { id: string; action: Action; text: string; error: boolean; retry?: () => Promise<void> };
type BusyAction = "read" | "edit" | "reprocess";
const enrichmentSchema = z.object({ summary: z.string().nullable(), category: z.string().nullable(), tags: z.string().nullable(), summarizedAt: z.string().nullable(), editedAt: z.string().nullable() });
async function responseJson(response: Response): Promise<unknown> {
  const json: unknown = await response.json();
  if (!response.ok) throw new Error(z.object({ error: z.string() }).safeParse(json).data?.error ?? `Request failed (${response.status})`);
  return json;
}

export function useBookmarksList(initial: Bookmark[]) {
  const operation = useOperationObserver({ discover: false, kind: "enrich" });
  const [items, setItems] = useState<Bookmark[]>(initial);
  const [busy, setBusy] = useState<Record<string, Partial<Record<BusyAction, number>>>>({});
  const [feedback, setFeedback] = useState<Record<string, BookmarkFeedback>>({});
  const [editing, setEditing] = useState<EditState>(null);
  const [selectedId, selectId] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const selection = useRef(selectedId); selection.current = selectedId;
  const editor = useRef(editing); editor.current = editing;
  const editorVersion = useRef(0);
  const contentVersions = useRef(new Map<string, number>());
  const readVersions = useRef(new Map<string, number>());
  const translationVersion = useRef(0);
  const translationRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; translationRequest.current?.abort(); }; }, []);
  useEffect(() => {
    setItems(initial);
    if (selection.current && !initial.some((item) => item.id === selection.current)) { selection.current = null; selectId(null); translationVersion.current++; translationRequest.current?.abort(); setTranslatingId(null); }
  }, [initial]);
  const setSelectedId = (id: string | null) => {
    if (selection.current !== id) { translationVersion.current++; translationRequest.current?.abort(); setTranslatingId(null); }
    selection.current = id; selectId(id);
  };
  function activity(id: string, action: BusyAction, change: number) {
    if (mounted.current) setBusy((previous) => ({ ...previous, [id]: { ...previous[id], [action]: Math.max(0, (previous[id]?.[action] ?? 0) + change) } }));
  }
  function clearFeedback(id: string, action: Action) { setFeedback((previous) => { const next = { ...previous }; delete next[`${id}:${action}`]; return next; }); }
  function notice(id: string, action: Action, text: string, error = false, retry?: () => Promise<void>) {
    if (mounted.current) setFeedback((previous) => ({ ...previous, [`${id}:${action}`]: { id, action, text, error, retry } }));
  }
  function nextVersion(versions: Map<string, number>, id: string) { const next = (versions.get(id) ?? 0) + 1; versions.set(id, next); return next; }

  async function translate(id: string): Promise<void> {
    if (selection.current !== id) return;
    const version = ++translationVersion.current; translationRequest.current?.abort();
    const controller = new AbortController(); translationRequest.current = controller;
    setTranslatingId(id); clearFeedback(id, "translate");
    try {
      const json = await responseJson(await fetch(`/api/bookmarks/translate?bookmarkId=${encodeURIComponent(id)}`, { method: "POST", signal: controller.signal }));
      const result = z.object({ translatedText: z.string().min(1) }).parse(json);
      if (!mounted.current || controller.signal.aborted || translationVersion.current !== version || selection.current !== id) return;
      setTranslations((previous) => ({ ...previous, [id]: result.translatedText })); notice(id, "translate", "Translation completed.");
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && translationVersion.current === version && selection.current === id) notice(id, "translate", error instanceof Error ? error.message : "Translation failed", true, () => translate(id));
    } finally { if (mounted.current && translationVersion.current === version) setTranslatingId(null); }
  }
  async function reprocess(id: string, replaceEdited = false, resumeRunId?: string): Promise<void> {
    const version = nextVersion(contentVersions.current, id); activity(id, "reprocess", 1); clearFeedback(id, "reprocess");
    let retryRunId: string | undefined;
    try {
      const url = `/api/enrich/one?bookmarkId=${encodeURIComponent(id)}${replaceEdited ? "&replaceEdited=true" : ""}${resumeRunId ? `&runId=${encodeURIComponent(resumeRunId)}&resume=true` : ""}`;
      const run = await operation.submit(url);
      if (!run) return;
      if (run.status === "completed" && run.skipped && !run.updated) { notice(id, "reprocess", "Human edits were preserved. Choose Replace human correction to regenerate them."); return; }
      if (run.status !== "completed" || !run.updated) { retryRunId = run.jobJson ? run.id : undefined; throw new Error(run.notes ?? `Reprocessing ${run.status}. Open Processing for details.`); }
      const json = await responseJson(await fetch(`/api/bookmarks/${encodeURIComponent(id)}`));
      const parsed = z.object({ bookmark: enrichmentSchema.extend({ id: z.literal(id), error: z.string().nullable(), captureJson: z.string().nullable(), summarySource: z.string().nullable() }) }).parse(json);
      if (!mounted.current || contentVersions.current.get(id) !== version) return;
      setItems((previous) => previous.map((item) => item.id === id ? { ...item, ...parsed.bookmark } : item)); notice(id, "reprocess", "Reprocessed bookmark.");
    } catch (error) { if (contentVersions.current.get(id) === version) notice(id, "reprocess", error instanceof Error ? error.message : "Reprocess failed", true, () => reprocess(id, replaceEdited, retryRunId)); }
    finally { activity(id, "reprocess", -1); }
  }
  async function updateRead(id: string, read: boolean): Promise<void> {
    const version = nextVersion(readVersions.current, id); activity(id, "read", 1); clearFeedback(id, "read");
    try {
      const json = await responseJson(await fetch("/api/bookmarks/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookmarkId: id, read }) }));
      const result = z.object({ bookmark: z.object({ id: z.literal(id), readAt: z.string().nullable() }) }).parse(json);
      if (!mounted.current || readVersions.current.get(id) !== version) return;
      setItems((previous) => previous.map((item) => item.id === id ? { ...item, readAt: result.bookmark.readAt } : item)); notice(id, "read", read ? "Marked read." : "Marked unread.");
    } catch (error) { if (readVersions.current.get(id) === version) notice(id, "read", error instanceof Error ? error.message : "Update failed", true, () => updateRead(id, read)); }
    finally { activity(id, "read", -1); }
  }
  const toggleRead = (bookmark: Bookmark) => updateRead(bookmark.id, !bookmark.readAt);
  const openEdit = (bookmark: Bookmark) => { editorVersion.current++; const draft = { id: bookmark.id, summary: bookmark.summary ?? "", category: bookmark.category ?? "", tags: bookmark.tags ?? "" }; editor.current = draft; setEditing(draft); };
  const closeEdit = () => { editorVersion.current++; editor.current = null; setEditing(null); };
  async function saveEdit(): Promise<void> {
    const draft = editor.current; if (!draft) return;
    const session = editorVersion.current; const version = nextVersion(contentVersions.current, draft.id); activity(draft.id, "edit", 1); clearFeedback(draft.id, "edit");
    try {
      const json = await responseJson(await fetch("/api/enrich/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookmarkId: draft.id, summary: draft.summary, category: draft.category, tags: draft.tags }) }));
      const result = z.object({ bookmark: enrichmentSchema.extend({ id: z.literal(draft.id) }) }).parse(json);
      if (!mounted.current || contentVersions.current.get(draft.id) !== version) return;
      setItems((previous) => previous.map((item) => item.id === draft.id ? { ...item, ...result.bookmark } : item)); notice(draft.id, "edit", "Enrichment updated.");
      if (editorVersion.current === session && JSON.stringify(editor.current) === JSON.stringify(draft)) { editor.current = null; setEditing(null); }
    } catch (error) { if (contentVersions.current.get(draft.id) === version) notice(draft.id, "edit", error instanceof Error ? error.message : "Update failed", true, saveEdit); }
    finally { activity(draft.id, "edit", -1); }
  }
  const selected = selectedId ? items.find((item) => item.id === selectedId) ?? null : null;
  const feedbacks = Object.values(feedback).filter((entry) => entry.id === selectedId || entry.id === editing?.id || (!selectedId && !editing)).slice(-5);
  const busyIds = Object.keys(busy).filter((id) => Object.values(busy[id]).some((count) => count && count > 0));
  return { items, operation, setItems, busyId: selectedId && busyIds.includes(selectedId) ? selectedId : busyIds[0] ?? null, busyIds,
    processingIds: Object.keys(busy).filter((id) => (busy[id].reprocess ?? 0) > 0), readingIds: Object.keys(busy).filter((id) => (busy[id].read ?? 0) > 0), savingIds: Object.keys(busy).filter((id) => (busy[id].edit ?? 0) > 0),
    message: feedbacks.at(-1)?.text ?? null, feedbacks, editing, setEditing, selectedId, setSelectedId,
    translatedText: selectedId ? translations[selectedId] ?? null : null, isTranslating: selectedId === translatingId && translatingId !== null,
    translate, reprocess, toggleRead, openEdit, closeEdit, saveEdit, selected };
}
