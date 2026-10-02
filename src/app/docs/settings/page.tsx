import Link from "next/link";
import { DocsPageShell } from "../DocsPageShell";

const tabs = [
  {
    id: "connections",
    label: "Connections",
    blurb: "X and YouTube accounts",
    when: "You cannot import bookmarks or playlists, or OAuth expired.",
    detail: (
      <>
        <p className="text-sm text-on-surface-variant leading-6">
          Two panels: <strong>X integration</strong> and <strong>YouTube integration</strong>.
        </p>
        <ul className="list-disc list-inside text-sm text-on-surface-variant leading-6 space-y-1.5">
          <li>
            <strong>X</strong> — OAuth client ID/secret, redirect URI, access/refresh tokens.{" "}
            <strong>Save &amp; Connect</strong>, <strong>Disconnect</strong>,{" "}
            <strong>Test connection</strong>, <strong>Run diagnostics</strong>. Optional user ID lookup for the
            account you want to pull bookmarks for.
          </li>
          <li>
            <strong>YouTube</strong> — <strong>Browse Google OAuth JSON</strong> to fill client fields, or enter
            them manually, then <strong>Save &amp; Connect YouTube</strong>. Same test/diagnostics pattern;{" "}
            <strong>Copy OAuth URL</strong> helps when the browser flow needs a manual link.
          </li>
        </ul>
        <p className="text-sm text-on-surface-variant leading-6">
          Step-by-step:{" "}
          <Link href="/docs/connections" className="text-primary hover:underline font-semibold">
            Connecting your accounts
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "ai",
    label: "AI",
    blurb: "Models, prompts, and tests",
    when: "Enrich fails, summaries never appear, or semantic search has no vectors.",
    detail: (
      <>
        <p className="text-sm text-on-surface-variant leading-6">
          Section title in the form: <strong>AI / LLM</strong>. Pick a preset (LM Studio, Ollama, REMOTE,
          vLLM localhost), set base URL, API key, chat model, embedding model / base URL, concurrency, context
          window, response limit, and target language for translations.
        </p>
        <ul className="list-disc list-inside text-sm text-on-surface-variant leading-6 space-y-1.5">
          <li>
            <strong>Test chat with displayed values</strong> and <strong>Test embeddings with displayed values</strong> — separate small tests of the unsaved draft. A working chat test does not verify embeddings. Save the draft before starting operations.
          </li>
          <li>
            <strong>Fetch models</strong> — pull model IDs from the server when available.
          </li>
          <li>
            <strong>Show advanced</strong> — system prompt, enrichment prompt (reset to default), enable LLM
            thinking, log payloads, cleanup helpers.
          </li>
        </ul>
        <p className="text-sm text-on-surface-variant leading-6">
          Deep dive:{" "}
          <Link href="/docs/llm" className="text-primary hover:underline font-semibold">
            Configure your AI (LLM)
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "limits",
    label: "Limits",
    blurb: "Caps, batches, and sounds",
    when: "You hit API quotas, batches time out, or you want completion/error sounds.",
    detail: (
      <>
        <p className="text-sm font-bold text-on-surface">Usage limits</p>
        <ul className="list-disc list-inside text-sm text-on-surface-variant leading-6 space-y-1.5">
          <li>
            <strong>X monthly cap</strong> — maximum new local entries imported from X per month. Refreshing an existing entry does not use this cap.
          </li>
          <li>
            <strong>YouTube monthly cap</strong> — maximum new local playlist entries imported per month. Google API request quota is separate. Paused imports retain their checkpoint.
          </li>
          <li>
            <strong>Enrichment batch size</strong> — items selected for one operation batch. Each bookmark has its own model request. Response tokens and parallel requests are separate settings.
          </li>
        </ul>
        <p className="text-sm font-bold text-on-surface mt-3">Maintenance actions</p>
        <ul className="list-disc list-inside text-sm text-on-surface-variant leading-6 space-y-1.5">
          <li>
            <strong>Mark latest X bookmark as baseline</strong> — next X sync only pulls newer items after that
            baseline.
          </li>
          <li>
            <strong>Reset X sync baseline</strong> — clear the baseline so a future sync can re-walk history
            (respects caps).
          </li>
          <li>
            <strong>Sync all missing embeddings</strong> — backfill vectors for summarized items so semantic search
            works.
          </li>
        </ul>
        <p className="text-sm font-bold text-on-surface mt-3">Audio configuration</p>
        <ul className="list-disc list-inside text-sm text-on-surface-variant leading-6 space-y-1.5">
          <li>
            <strong>Sound on complete</strong> — notify when a batch enrichment finishes successfully (preview
            available).
          </li>
          <li>
            <strong>Sound on error</strong> — notify when an item fails (preview available).
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "data",
    label: "Data",
    blurb: "Backup and restore",
    when: "Moving machines, upgrading carefully, or recovering from a bad experiment.",
    detail: (
      <>
        <p className="text-sm text-on-surface-variant leading-6">
          Section: <strong>Database management</strong> — local SQLite is the source of truth for bookmarks and
          settings.
        </p>
        <ul className="list-disc list-inside text-sm text-on-surface-variant leading-6 space-y-1.5">
          <li>
            <strong>Download active database (.db)</strong> — download a consistent SQLite snapshot. Stored credentials are omitted by default; select the credential option only when you intend to include them.
          </li>
          <li>
            <strong>Save to server</strong> — create a full local backup stored with the app. It includes credentials and technical logs. An existing custom name is rejected instead of overwritten.
          </li>
          <li>
            <strong>Restore from file</strong> — upload a previous <code className="rounded bg-white px-1 py-0.5 text-xs">.db</code>{" "}
            (confirm before replacement). Restore checks integrity and schema, blocks conflicting work, keeps a recovery snapshot, and rolls back if replacement fails.
          </li>
          <li>
            <strong>Server backups list</strong> — restore or delete saved backups.
          </li>
          <li>
            <strong>Clear database data</strong> — destructive wipe of local data (confirm dialog). Prefer a
            download first.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "agents",
    label: "Agents",
    blurb: "Agent API access",
    when: "Hermes, scripts, or tools need to search or update bookmarks over HTTP.",
    detail: (
      <>
        <p className="text-sm text-on-surface-variant leading-6">
          Shows the live base URL (e.g.{" "}
          <code className="rounded bg-white px-1.5 py-0.5 text-xs">http://localhost:3000/api/agent</code>), whether{" "}
          <code className="rounded bg-white px-1.5 py-0.5 text-xs">AGENT_API_TOKEN</code> is configured, and
          copy-friendly read/write examples.
        </p>
        <p className="text-sm text-on-surface-variant leading-6">
          Full reference:{" "}
          <Link href="/docs/agent-api" className="text-primary hover:underline font-semibold">
            Agent API
          </Link>
          . Example recipe:{" "}
          <Link href="/docs/scenarios#hermes-obsidian" className="text-primary hover:underline font-semibold">
            Hermes + Obsidian
          </Link>
          .
        </p>
      </>
    ),
  },
];

export default function DocsSettingsPage() {
  return (
    <DocsPageShell
      title="Settings"
      description="Central configuration for accounts, AI models, import caps, database backups, and the local Agent API. Open it anytime from the nav."
    >
      <div className="space-y-10">
        <section className="rounded-2xl bg-white p-6 shadow-sm border border-outline-variant/30 space-y-4">
          <h2 className="text-xl font-bold text-on-surface">How Settings works</h2>
          <ul className="list-disc list-inside text-sm text-on-surface-variant leading-6 space-y-2">
            <li>
              Open{" "}
              <Link href="/settings" className="text-primary hover:underline font-semibold">
                Settings
              </Link>{" "}
              from the sidebar. Values are stored in the local SQLite database (not only env vars).
            </li>
            <li>
              Use the <strong>tabs</strong> (Connections, AI, Limits, Data, Agents) to focus one area at a time.
            </li>
            <li>
              <strong>Setup status</strong> chips distinguish configured, tested, disconnected, expired, and unavailable connections. A saved token or model name does not establish connectivity. Changing a tested draft invalidates that result.
            </li>
            <li>
              Change fields, then click <strong>Save settings</strong>. An <strong>Unsaved changes</strong> badge
              appears while the form is dirty. Tabs preserve edits and test results. Server refreshes preserve a dirty draft. Leaving Settings offers a discard choice. A failed save retains edits and shows an error; a successful save shows Settings saved.
            </li>
            <li>
              Env vars (e.g. <code className="rounded bg-surface-container-low px-1 py-0.5 text-xs">OPENAI_*</code>,{" "}
              <code className="rounded bg-surface-container-low px-1 py-0.5 text-xs">X_CLIENT_ID</code>) are optional
              fallbacks when Settings fields are empty—see{" "}
              <Link href="/docs/setup" className="text-primary hover:underline font-semibold">
                Development setup
              </Link>
              .
            </li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-on-surface">Tabs</h2>
          <p className="text-sm text-on-surface-variant leading-6 max-w-2xl">
            Each tab matches the labels in the Settings UI. Jump to the one that matches your problem.
          </p>
          <div className="space-y-6">
            {tabs.map((tab) => (
              <article
                key={tab.id}
                id={tab.id}
                className="rounded-2xl border border-outline-variant/30 bg-white p-6 shadow-sm space-y-4"
              >
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-xl font-bold text-primary">{tab.label}</h3>
                  <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    {tab.blurb}
                  </span>
                </div>
                <p className="text-sm text-on-surface-variant leading-6">
                  <span className="font-bold text-on-surface">When to open this tab: </span>
                  {tab.when}
                </p>
                <div className="space-y-3 border-t border-outline-variant/30 pt-4">{tab.detail}</div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-6 space-y-3">
          <h2 className="text-lg font-bold text-primary">Suggested order for a new install</h2>
          <ol className="list-decimal list-inside text-sm text-on-surface-variant leading-6 space-y-1.5">
            <li>
              <strong>Connections</strong> — OAuth for X and/or YouTube, Test connection.
            </li>
            <li>
              <strong>AI</strong> — choose endpoints and models, test chat and embeddings separately, then Save settings.
            </li>
            <li>
              <strong>Limits</strong> — set caps and batch size if you care about API spend.
            </li>
            <li>
              Dashboard →{" "}
              <Link href="/docs/process-inbox" className="text-primary hover:underline font-semibold">
                Process inbox
              </Link>
              .
            </li>
            <li>
              Optional: <strong>Data</strong> backup after the first good import; <strong>Agents</strong> when
              wiring Hermes.
            </li>
          </ol>
        </section>
      </div>
    </DocsPageShell>
  );
}
