"use client";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function usePanelFocus(panel: RefObject<HTMLElement | null>, open: boolean, trap: boolean, identity: string | null, close: () => void, restore?: () => void) {
  const closeAction = useRef(close);
  const restoreAction = useRef(restore);
  useLayoutEffect(() => { closeAction.current = close; restoreAction.current = restore; }, [close, restore]);
  useEffect(() => {
    if (!open || !panel.current) return;
    const element = panel.current;
    (element.querySelector<HTMLElement>("[data-initial-focus]") ?? element).focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAction.current(); return; }
      if (!trap || event.key !== "Tab") return;
      const controls = [...element.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])")].filter((control) => !control.hidden && control.getAttribute("aria-hidden") !== "true");
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); const restoreFocus = restoreAction.current; if (restoreFocus) requestAnimationFrame(() => restoreFocus()); };
  }, [open, trap, identity, panel]);
}
