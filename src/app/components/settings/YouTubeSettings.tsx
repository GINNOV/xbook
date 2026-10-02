"use client";

import { useSettingsContext } from "../../hooks/settings/useSettingsContext";
import { useYouTubeSettings } from "../../hooks/settings/useYouTubeSettings";
import { CredentialsForm } from "./youtube/CredentialsForm";
import { ActionButtons } from "./youtube/ActionButtons";
import { DiagnosticsProbe } from "./youtube/DiagnosticsProbe";
import { YouTubeLogo } from "../Icons";
import { ConnectionBadge, ConnectionBanner, SettingsSection } from "./SharedFields";

import { connectionState } from "../../lib/settings-draft";

function youtubeConnectionState(tested: boolean, waiting: boolean) {
  if (tested) return "connected" as const;
  if (waiting) return "waiting" as const;
  return "disconnected" as const;
}

function formatExpiry(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function YouTubeSettings() {
  const { form, updateField, saving, connectionTests } = useSettingsContext();
  const yt = useYouTubeSettings();
  const connected = Boolean(form.ytAccessToken);
  const honestState = connectionState("yt", form, connectionTests.yt);
  const state = youtubeConnectionState(honestState === "tested", yt.oauthWaiting);
  const expiry = formatExpiry(form.ytTokenExpiresAt);

  return (
    <SettingsSection
      title="YouTube integration"
      description="Connect Google to import playlists and video bookmarks."
      icon={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"><YouTubeLogo className="h-4 w-6" /></span>}
      badge={
        <ConnectionBadge
          state={state}
          label={yt.oauthWaiting ? "Waiting in browser" : honestState === "configured" ? "Configured, not tested" : honestState}
        />
      }
      defaultOpen={connected || yt.oauthWaiting}
    >
      <div className="flex flex-col gap-4">
        <ConnectionBanner
          state={state}
          title={
            state === "connected"
              ? "YouTube connection tested"
              : state === "waiting"
                ? "Finish sign-in in your browser"
                : honestState === "expired" ? "YouTube token expired" : honestState === "unavailable" ? "YouTube connection unavailable" : connected ? "YouTube configured, not tested" : "YouTube disconnected"
          }
          detail={
            state === "connected"
              ? expiry
                ? `Access token is stored. It expires ${expiry}.`
                : "Access token is stored. Playlists and saved videos can be imported."
              : state === "waiting"
                ? "Approve access in the browser window that just opened. This panel turns green when Google comes back."
                : connected ? "Test the displayed connection to verify access. Expired tokens may refresh during testing; reconnect if refresh fails. Saved library items are preserved." : "Save your Google client details, then connect. Sign-in always happens in the system browser."
          }
        />
        <h3 className="text-sm font-semibold">OAuth credentials</h3>
        <CredentialsForm form={form} updateField={updateField} {...yt} />
        <ActionButtons saving={saving} {...yt} />
        <DiagnosticsProbe result={yt.ytDiagnosticResult} />
      </div>
    </SettingsSection>
  );
}
