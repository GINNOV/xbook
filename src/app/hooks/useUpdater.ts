"use client";

import { useEffect, useState } from "react";

export function useUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checkNonce, setCheckNonce] = useState(0);

  useEffect(() => {
    // Check if running in Tauri environment
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let mounted = true;
    const checkUpdates = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check({ timeout: 10000 });
        if (!mounted) return;
        if (update) {
          console.log(`[Updater] New version found: ${update.version}`);
          setUpdateVersion(update.version);
          setUpdateAvailable(true);

          // Ask the user if they want to update
          const confirmUpdate = window.confirm(
            `A new version (${update.version}) of XBook Console is available. Would you like to download and install it now?`
          );

          if (confirmUpdate) {
            setIsUpdating(true);
            console.log("[Updater] Starting update download and install...");
            
            // Download and install
            await update.downloadAndInstall();
            console.log("[Updater] Update installed successfully. Relaunching...");
            
            // Relaunch the application
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("relaunch_app");
          }
        } else {
          console.log("[Updater] No updates found.");
        }
      } catch (err) {
        if (!mounted) return;
        setUpdateError("Update check failed. Startup continues. Check your network connection and retry when the update server is reachable.");
        console.warn("[Updater] Update check failed:", err);
      } finally {
        if (mounted) setIsUpdating(false);
      }
    };

    // Delay the update check slightly after boot so it doesn't block startup
    const timer = setTimeout(() => {
      checkUpdates();
    }, 5000);

    return () => { mounted = false; clearTimeout(timer); };
  }, [checkNonce]);

  return {
    updateAvailable,
    isUpdating,
    updateVersion,
    updateError,
    retryUpdateCheck: () => {
      setUpdateError(null);
      setCheckNonce((value) => value + 1);
    },
  };
}
