"use client";

import { useState, useRef, useEffect } from "react";
import { useSettingsContext } from "./useSettingsContext";
import { connectionFingerprint } from "../../lib/settings-draft";
import { isTauriApp, openExternalUrl } from "@/app/lib/tauri";
import { liveYouTubeRedirectUri, waitForYouTubeToken } from "@/app/lib/youtube-oauth-connect";

export function useYouTubeSettings() {
  const { form, setForm, setSaving, setMessage, persistSettings, applySavedPatch, connectionTests, testConnection } = useSettingsContext();
  
  const test = connectionTests.yt?.fingerprint === connectionFingerprint("yt", form) ? connectionTests.yt : undefined;
  const [runningYtDiagnostics, setRunningYtDiagnostics] = useState(false);
  const [ytDiagnosticResult, setYtDiagnosticResult] = useState<unknown>(null);
  const [generatingYtUrl, setGeneratingYtUrl] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const waitingController = useRef<AbortController | null>(null);
  useEffect(() => () => waitingController.current?.abort(), []);
  const stopWaiting = () => {
    waitingController.current?.abort(); setOauthWaiting(false);
    setMessage("Stopped waiting for sign-in. Account authorization and saved library items are unchanged.");
  };
  const ytJsonInputRef = useRef<HTMLInputElement | null>(null);

  const testYt = () => testConnection("yt");

  const clearYouTubeOAuth = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ytAccessToken: "",
          ytRefreshToken: "",
          ytTokenExpiresAt: null,
          ytScope: "",
          ytTokenType: "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Clear failed");
      applySavedPatch({
        ytAccessToken: null,
        ytRefreshToken: null,
        ytTokenExpiresAt: null,
        ytScope: null,
        ytTokenType: null,
      });
      setMessage("YouTube OAuth connection cleared.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  };

  const connectYouTubeOAuth = async () => {
    const callbackUri = liveYouTubeRedirectUri();
    const nextForm =
      callbackUri && callbackUri !== form.ytRedirectUri
        ? { ...form, ytRedirectUri: callbackUri }
        : form;
    if (nextForm !== form) setForm(nextForm);

    const ok = await persistSettings(nextForm);
    if (!ok) return;

    const previousExpiresAt = form.ytTokenExpiresAt;
    setOauthWaiting(true);
    if (isTauriApp()) {
      setMessage("Complete YouTube sign-in in your browser. This window updates when it finishes.");
    }
    try { await openExternalUrl("/api/oauth/youtube/start"); }
    catch (error) { setOauthWaiting(false); setMessage(error instanceof Error ? error.message : "Unable to open sign-in. Try again."); return; }
    if (!isTauriApp()) {
      setOauthWaiting(false);
      return;
    }

    waitingController.current?.abort();
    const controller = new AbortController(); waitingController.current = controller;
    let connected;
    try { connected = await waitForYouTubeToken({ previousExpiresAt, signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted) return;
      setOauthWaiting(false); setMessage(error instanceof Error ? error.message : "Sign-in check failed. Try testing the connection."); return;
    }
    if (controller.signal.aborted) return;
    setOauthWaiting(false);
    if (connected) {
      const expiry = connected.ytTokenExpiresAt;
      applySavedPatch({
        ytAccessToken: connected.ytAccessToken ?? form.ytAccessToken,
        ytRefreshToken: connected.ytRefreshToken ?? form.ytRefreshToken,
        ytTokenExpiresAt:
          expiry instanceof Date ? expiry.toISOString() : expiry ?? form.ytTokenExpiresAt,
        ytScope: connected.ytScope ?? form.ytScope,
        ytTokenType: connected.ytTokenType ?? form.ytTokenType,
        ytRedirectUri: connected.ytRedirectUri ?? form.ytRedirectUri,
      });
      setMessage("YouTube connected.");
      return;
    }
    setMessage("Still waiting for YouTube sign-in. Finish in the browser, then click Test connection.");
  };

  const runYtDiagnostics = async () => {
    setRunningYtDiagnostics(true);
    setYtDiagnosticResult(null);
    try {
      const res = await fetch("/api/youtube/diagnostics", {
        method: "GET",
        cache: "no-store",
      });
      const json = await res.json();
      setYtDiagnosticResult(json);
    } catch (error) {
      setYtDiagnosticResult({
        ok: false,
        error: error instanceof Error ? error.message : "YouTube diagnostics failed",
      });
    } finally {
      setRunningYtDiagnostics(false);
    }
  };

  const getYouTubeAuthUrl = async () => {
    setGeneratingYtUrl(true);
    setMessage(null);
    try {
      const res = await fetch("/api/youtube/oauth/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to generate URL");
      return json.url as string;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to generate URL");
      return null;
    } finally {
      setGeneratingYtUrl(false);
    }
  };

  const uploadGoogleClientJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as {
        web?: {
          client_id?: string;
          client_secret?: string;
          redirect_uris?: string[];
        };
        installed?: {
          client_id?: string;
          client_secret?: string;
          redirect_uris?: string[];
        };
      };
      const config = parsed.web ?? parsed.installed;
      if (!config?.client_id || !config?.client_secret) {
        throw new Error("JSON is missing client_id or client_secret.");
      }
      setForm((prev) => ({
        ...prev,
        ytClientId: config.client_id,
        ytClientSecret: config.client_secret,
        ytRedirectUri: config.redirect_uris?.[0] ?? prev.ytRedirectUri,
      }));
      setMessage("Loaded YouTube OAuth credentials from JSON file.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read JSON file.");
    } finally {
      event.target.value = "";
    }
  };

  return {
    ytTest: test?.message ?? null,
    testingYt: test?.status === "testing",
    runningYtDiagnostics,
    ytDiagnosticResult,
    generatingYtUrl,
    oauthWaiting,
    stopWaiting,
    ytJsonInputRef,
    testYt,
    clearYouTubeOAuth,
    connectYouTubeOAuth,
    runYtDiagnostics,
    getYouTubeAuthUrl,
    uploadGoogleClientJson,
  };
}
