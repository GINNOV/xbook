"use client";

import { useEffect } from "react";
import { interceptAnchorClick, isTauriRuntime, openExternalUrl } from "@/app/lib/tauri";

/** In Tauri, target=_blank does not open a window. Route those clicks through open_in_browser. */
export function useTauriExternalLinks() {
  useEffect(() => {
    if (typeof window === "undefined" || !isTauriRuntime(window)) return;

    const onClick = (event: MouseEvent) => {
      const href = interceptAnchorClick(event);
      if (!href) return;
      event.preventDefault();
      void openExternalUrl(href);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
