"use client";

import { useSettingsContext } from "../../hooks/settings/useSettingsContext";
import { useYouTubeSettings } from "../../hooks/settings/useYouTubeSettings";
import { CredentialsForm } from "./youtube/CredentialsForm";
import { ActionButtons } from "./youtube/ActionButtons";
import { DiagnosticsProbe } from "./youtube/DiagnosticsProbe";
import { YouTubeLogo } from "../Icons";
import { ConnectionBadge, ConnectionBanner, SettingsSection } from "./SharedFields";

function youtubeConnectionState(connected: boolean, waiting: boolean) {
  if (connected) return "connected" as const;
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
  const { form, updateField, saving } = useSettingsContext();
  const yt = useYouTubeSettings();
  const connected = Boolean(form.ytAccessToken);
  const state = youtubeConnectionState(connected, yt.oauthWaiting);
  const expiry = formatExpiry(form.ytTokenExpiresAt);

  return (
    <SettingsSection
      title="YouTube integration"
      description="Connect Google to import playlists and video bookmarks."
      icon={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"><YouTubeLogo className="h-4 w-6" /></span>}
      badge={
        <ConnectionBadge
          state={state}
          label={state === "connected" ? "Connected" : state === "waiting" ? "Waiting in browser" : "Not connected"}
        />
      }
      defaultOpen={connected || yt.oauthWaiting}
    >
      <div className="flex flex-col gap-4">
        <ConnectionBanner
          state={state}
          title={
            state === "connected"
              ? "YouTube is connected"
              : state === "waiting"
                ? "Finish sign-in in your browser"
                : "YouTube is not connected"
          }
          detail={
            state === "connected"
              ? expiry
                ? `Access token is stored. It expires ${expiry}.`
                : "Access token is stored. Playlists and saved videos can be imported."
              : state === "waiting"
                ? "Approve access in the browser window that just opened. This panel turns green when Google comes back."
                : "Save your Google client details, then connect. Sign-in always happens in the system browser."
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
