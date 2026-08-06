import Link from "next/link";
import type { SetupReadiness } from "@/lib/setup-readiness";

type Props = {
  tab: "x" | "yt";
  total: number;
  readiness: SetupReadiness;
};

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-on-surface">
      <span
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok ? "bg-emerald-100 text-emerald-800" : "bg-surface-container-high text-on-surface-variant"
        }`}
        aria-hidden
      >
        {ok ? "✓" : "·"}
      </span>
      <span className={ok ? "text-on-surface" : "text-on-surface-variant"}>{label}</span>
    </li>
  );
}

/**
 * First-run empty state when the library is empty, or a compact banner when
 * Process inbox is blocked (missing OAuth or chat model) but bookmarks exist.
 * Embedding-only gaps stay as checklist items / Settings chips — they do not
 * block Process inbox.
 */
export function SetupBanner({ tab, total, readiness }: Props) {
  const sourceLabel = tab === "x" ? "X" : "YouTube";
  const isEmpty = total === 0;
  const processBlocked = !readiness.canProcessInbox;

  if (!isEmpty && !processBlocked) return null;

  if (isEmpty) {
    return (
      <section
        className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-sm"
        aria-labelledby="setup-banner-title"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Getting started</p>
            <h2 id="setup-banner-title" className="font-headline text-2xl font-semibold tracking-tight">
              No {sourceLabel} bookmarks yet
            </h2>
            <p className="text-sm leading-6 text-on-surface-variant">
              Connect your account and a local (or remote) LLM, then use{" "}
              <strong className="font-semibold text-on-surface">Process inbox</strong> to import,
              summarize, and index. Day-to-day work lives on this dashboard after setup.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link
                href="/settings"
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Open Settings
              </Link>
              <Link
                href="/docs"
                className="rounded-full border border-outline-variant px-5 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container-low"
              >
                Getting started guide
              </Link>
              <Link
                href="/docs/connections"
                className="rounded-full border border-outline-variant px-5 py-2 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-low"
              >
                Connect accounts
              </Link>
            </div>
          </div>

          <ol className="w-full max-w-sm space-y-3 rounded-lg bg-surface-container-low px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              Setup checklist
            </p>
            <CheckRow
              ok={readiness.sourceConnected}
              label={
                readiness.sourceConnected
                  ? `${sourceLabel} connected`
                  : `Connect ${sourceLabel} (Settings → Connections)`
              }
            />
            <CheckRow
              ok={readiness.chatModelSet}
              label={
                readiness.chatModelSet
                  ? "Chat model set"
                  : "Set chat model (Settings → AI)"
              }
            />
            <CheckRow
              ok={readiness.embeddingModelSet}
              label={
                readiness.embeddingModelSet
                  ? "Embedding model set"
                  : "Set embedding model (Settings → AI)"
              }
            />
            <CheckRow
              ok={false}
              label={`Process inbox on this tab to pull ${sourceLabel === "X" ? "bookmarks" : "saved videos"}`}
            />
          </ol>
        </div>
      </section>
    );
  }

  // Library has items but Process inbox is blocked — compact reminder
  const processBlockers = readiness.blockers.filter((b) => !b.toLowerCase().includes("embedding"));
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-amber-950">Finish setup to process the inbox</p>
        <p className="text-xs leading-5 text-amber-900/80">
          {processBlockers.join(" · ") || "Connect your account and set a chat model in Settings."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <Link
          href="/settings"
          className="rounded-full bg-amber-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-950"
        >
          Settings
        </Link>
        <Link
          href="/docs"
          className="rounded-full border border-amber-300 px-4 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-100"
        >
          Docs
        </Link>
      </div>
    </section>
  );
}
