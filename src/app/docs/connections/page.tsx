import Link from "next/link";
import { DocsPageShell } from "../DocsPageShell";

export default function DocsConnectionsPage() {
  return (
    <DocsPageShell
      title="Connecting your accounts"
      description="Link X and YouTube so Process inbox can import bookmarks and saved videos. Credentials live in the local Settings database."
    >
      <div className="space-y-8">
        <p className="text-on-surface-variant max-w-2xl leading-relaxed">
          Open{" "}
          <Link href="/settings?tab=connections" className="text-primary hover:underline font-semibold">
            Settings
          </Link>{" "}
          → <strong>Connections</strong>. Env vars are optional fallbacks for developers; the UI is the primary path.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="p-6 rounded-xl bg-surface-container-lowest border border-outline-variant/50 space-y-3">
            <h2 className="font-bold text-lg text-primary">X integration</h2>
            <p className="text-sm text-on-surface-variant leading-6">
              Enter your X OAuth client ID (and secret if required), set the redirect URI, then click{" "}
              <strong>Save &amp; Connect</strong>. Use <strong>Test displayed X connection</strong> or{" "}
              <strong>Run diagnostics</strong> if import fails. Diagnostics probe saved settings; the test uses displayed draft values.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-surface-container-lowest border border-outline-variant/50 space-y-3">
            <h2 className="font-bold text-lg text-primary">YouTube integration</h2>
            <p className="text-sm text-on-surface-variant leading-6">
              Use <strong>Browse Google OAuth JSON</strong> to load a Google Cloud OAuth client file, confirm
              client ID/secret and redirect URI, then <strong>Save &amp; Connect YouTube</strong>. The desktop app
              opens Google sign-in in your system browser (embedded sign-in is blocked). Register{" "}
              <code className="rounded bg-surface-container-low px-1.5 py-0.5 text-xs">
                http://localhost:3000/api/oauth/youtube/callback
              </code>{" "}
              as an example redirect URI. Use the live origin shown in Settings; desktop ports can differ from 3000.
            </p>
          </div>
        </div>

        <section className="rounded-xl border border-outline-variant/30 bg-white p-6 space-y-3">
          <h2 className="text-lg font-bold">Connection states and recovery</h2>
          <p className="text-sm leading-6 text-on-surface-variant">Stored credentials show configured, not tested. Expired tokens show expired. A successful draft test shows tested; rejected credentials show unavailable. A changed token invalidates its earlier result. Refresh may renew an expired saved account during testing.</p>
          <p className="text-sm leading-6 text-on-surface-variant">If refresh or sign-in fails, reconnect from this tab. Cancellation and disconnect preserve saved library items. In the desktop app, Stop waiting for sign-in ends local observation; it does not revoke account authorization.</p>
        </section>

        <div className="p-6 rounded-2xl bg-primary/5 border border-primary/20 space-y-3">
          <p className="text-sm font-bold text-primary">Full Settings map</p>
          <p className="text-sm text-on-surface-variant leading-6">
            Connections is only one tab. For Limits, Data, Agents, setup chips, and save behavior, see{" "}
            <Link href="/docs/settings" className="text-primary hover:underline font-semibold">
              Settings documentation
            </Link>
            . For models and prompts:{" "}
            <Link href="/docs/llm" className="text-primary hover:underline font-semibold">
              Configure your AI (LLM)
            </Link>
            .
          </p>
        </div>
      </div>
    </DocsPageShell>
  );
}
