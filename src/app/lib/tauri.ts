type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

export function isTauriRuntime(win: { __TAURI_INTERNALS__?: unknown } | undefined | null): boolean {
  return Boolean(win && win.__TAURI_INTERNALS__);
}

export function isTauriApp(): boolean {
  return typeof window !== "undefined" && isTauriRuntime(window as TauriWindow);
}

export function resolveExternalUrl(url: string): string {
  return url.startsWith("/") ? `http://localhost:3000${url}` : url;
}

/** True when a click should leave the Tauri webview and open the OS browser. */
export function shouldOpenInSystemBrowser(href: string | null, target: string | null): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("#") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("data:")
  ) {
    return false;
  }

  const isBlank = target === "_blank";
  const isHttp = /^https?:\/\//i.test(trimmed);
  const isAppPath = trimmed.startsWith("/");

  if (isHttp) {
    try {
      const host = new URL(trimmed).hostname;
      const local = host === "localhost" || host === "127.0.0.1";
      if (local) return isBlank;
      return true;
    } catch {
      return false;
    }
  }

  return isBlank && isAppPath;
}

export function interceptAnchorClick(event: Pick<MouseEvent, "defaultPrevented" | "button" | "target">): string | null {
  if (event.defaultPrevented) return null;
  if (event.button !== 0) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a");
  if (!anchor || anchor.hasAttribute("download")) return null;
  const href = anchor.getAttribute("href");
  const linkTarget = anchor.getAttribute("target");
  if (!shouldOpenInSystemBrowser(href, linkTarget)) return null;
  return href;
}

export async function openExternalUrl(url: string) {
  const absoluteUrl = resolveExternalUrl(url);
  const win = typeof window === "undefined" ? undefined : (window as TauriWindow);

  if (isTauriRuntime(win)) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      console.log(`[Tauri] Opening external URL via Rust: ${absoluteUrl}`);
      await invoke("open_in_browser", { url: absoluteUrl });
      return;
    } catch (e) {
      console.error("[Tauri] Failed to open URL via Rust:", e);
      if (url.startsWith("/")) {
        window.location.href = url;
        return;
      }
      window.open(absoluteUrl, "_blank", "noopener,noreferrer");
      return;
    }
  }

  if (url.startsWith("/")) {
    window.location.href = url;
    return;
  }
  window.open(absoluteUrl, "_blank", "noopener,noreferrer");
}
