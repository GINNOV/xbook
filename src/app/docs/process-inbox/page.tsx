import Link from "next/link";
import { DocsPageShell } from "../DocsPageShell";

export default function DocsProcessInboxPage() {
  return (
    <DocsPageShell
      title="Process inbox"
      description="The day-to-day control on the Dashboard: import new items, enrich pending ones, and index embeddings for search."
    >
      <div className="space-y-8">
        <p className="text-on-surface-variant max-w-2xl leading-relaxed">
          On the{" "}
          <Link href="/" className="text-primary hover:underline font-semibold">
            Dashboard
          </Link>
          , each source tab (X or YouTube) has an <strong>Inbox</strong> card. Day-to-day you only need one control.
          Accounts and an LLM should already be configured (
          <Link href="/docs/connections" className="text-primary hover:underline font-semibold">
            connections
          </Link>
          ,{" "}
          <Link href="/docs/llm" className="text-primary hover:underline font-semibold">
            AI
          </Link>
          ).
        </p>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-outline-variant/30 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-black px-4 py-1.5 text-sm font-semibold text-white">
              Process inbox
            </span>
            <span className="text-xs font-bold uppercase tracking-wide text-emerald-800">
              Primary · recommended
            </span>
          </div>
          <p className="text-sm text-on-surface-variant leading-6">
            One button that runs the full pipeline for the active tab:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-on-surface-variant leading-6">
            <li>
              <strong>Import</strong> — pull new bookmarks or saved videos from the platform (no LLM
              required).
            </li>
            <li>
              <strong>Enrich</strong> — send items that still need a summary to your configured LLM for summary,
              category, and tags (needs{" "}
              <Link href="/docs/llm" className="text-primary hover:underline font-semibold">
                LLM setup
              </Link>
              ).
            </li>
            <li>
              <strong>Index embeddings</strong> — generate vectors for semantic search when an embedding model is
              configured.
            </li>
          </ol>
          <p className="text-sm text-on-surface-variant leading-6">
            Progress and errors show under the button and on the{" "}
            <Link href="/processing" className="text-primary hover:underline font-semibold">
              Processing
            </Link>{" "}
            page.
          </p>
        </div>

        <section className="rounded-2xl border border-outline-variant/30 bg-white p-6 space-y-3">
          <h2 className="text-lg font-bold">Continue from saved progress</h2>
          <p className="text-sm leading-6 text-on-surface-variant">Process inbox submits one server-owned run for import, summarization, and indexing. Navigating away does not cancel the run. Reopen the Dashboard or Processing to observe the same run and its cumulative counts. Stop persists a checkpoint; Resume continues that run after you repair its cause.</p>
          <p className="text-sm leading-6 text-on-surface-variant">A monthly new-entry cap pauses import with buffered work intact. Raise the relevant source cap in Settings → Limits, then Resume. Provider request quota is separate. A partial run contains completed work and unresolved failures; it is not complete. Failed-folder retry preserves completed folders and saved page progress.</p>
          <h2 className="text-lg font-bold">Folders and playlist entries</h2>
          <p className="text-sm leading-6 text-on-surface-variant"><Link href="/folders" className="text-primary hover:underline">Folder Management</Link> separates Sync names, Import, Summarize, and Index. Names and local counts open the exact source and folder. Import all continues on the server while you navigate. Refreshing an existing entry preserves manual summaries, read dates, and IDs.</p>
          <p className="text-sm leading-6 text-on-surface-variant">Local playlist entries and unique videos are different counts. A video saved in two playlists has two entries. Source playlist totals can exceed locally imported counts. Unknown upload dates and authors remain unknown; playlist-added time is not the upload date. Repair saved metadata repairs cached fields without changing bookmark IDs.</p>
          <h2 className="text-lg font-bold">Read Dashboard and Processing counts</h2>
          <p className="text-sm leading-6 text-on-surface-variant">Dashboard health follows the selected X or YouTube source. Index coverage is usable vectors divided by all local items in that source. Missing vectors on summarized items, stale or incompatible vectors, and pending summaries remain separate. Count links open the matching Library filter. Last import activity comes from a source import run that processed work.</p>
          <p className="text-sm leading-6 text-on-surface-variant">Processing shows authoritative run status, cumulative outcomes, saved causes, and recovery actions. Import pages and completed folders are not bookmark attempts. Opening Processing does not start another run.</p>
        </section>

        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 space-y-4">
          <h2 className="text-lg font-bold text-on-surface">Advanced actions</h2>
          <p className="text-sm text-on-surface-variant leading-6">
            Expand <strong>Advanced actions</strong> on the same Inbox card when you need finer control:
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-outline-variant/40 bg-white p-4 space-y-1">
              <p className="text-sm font-bold text-on-surface">Import X / Import YT</p>
              <p className="text-sm text-on-surface-variant leading-6">
                Import only—fetch new items without enriching.
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/40 bg-white p-4 space-y-1">
              <p className="text-sm font-bold text-on-surface">Enrich all</p>
              <p className="text-sm text-on-surface-variant leading-6">
                Summarize every pending item (or all items if force reprocess is on).
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/40 bg-white p-4 space-y-1">
              <p className="text-sm font-bold text-on-surface">Batch</p>
              <p className="text-sm text-on-surface-variant leading-6">
                Enrich a limited batch (size from Settings for X; fixed for YouTube).
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/40 bg-white p-4 space-y-1">
              <p className="text-sm font-bold text-on-surface">Force reprocess</p>
              <p className="text-sm text-on-surface-variant leading-6">
                Checkbox to re-run enrichment on items that already have summaries (e.g. after changing prompts or
                models).
              </p>
            </div>
          </div>
        </div>
      </div>
    </DocsPageShell>
  );
}
