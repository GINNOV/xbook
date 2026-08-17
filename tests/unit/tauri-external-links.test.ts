import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  interceptAnchorClick,
  isTauriRuntime,
  openExternalUrl,
  resolveExternalUrl,
  shouldOpenInSystemBrowser,
} from "@/app/lib/tauri";
import { useTauriExternalLinks } from "@/app/hooks/useTauriExternalLinks";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}));

describe("tauri external links", () => {
  describe("shouldOpenInSystemBrowser", () => {
    it("opens target=_blank http(s) tweet URLs", () => {
      expect(shouldOpenInSystemBrowser("https://x.com/i/web/status/1", "_blank")).toBe(true);
    });

    it("opens absolute http(s) even without target=_blank", () => {
      expect(shouldOpenInSystemBrowser("https://youtube.com/watch?v=abc", null)).toBe(true);
    });

    it("ignores in-app paths unless they request a new window", () => {
      expect(shouldOpenInSystemBrowser("/bookmarks", null)).toBe(false);
      expect(shouldOpenInSystemBrowser("/api/x/oauth/start", "_blank")).toBe(true);
    });

    it("ignores hashes, javascript, mailto, and empty hrefs", () => {
      expect(shouldOpenInSystemBrowser("#section", "_blank")).toBe(false);
      expect(shouldOpenInSystemBrowser("javascript:alert(1)", "_blank")).toBe(false);
      expect(shouldOpenInSystemBrowser("mailto:hi@example.com", "_blank")).toBe(false);
      expect(shouldOpenInSystemBrowser("  ", "_blank")).toBe(false);
      expect(shouldOpenInSystemBrowser(null, "_blank")).toBe(false);
    });

    it("does not steal same-window localhost navigation", () => {
      expect(shouldOpenInSystemBrowser("http://localhost:3000/settings", null)).toBe(false);
      expect(shouldOpenInSystemBrowser("http://localhost:3000/docs", "_blank")).toBe(true);
    });
  });

  describe("interceptAnchorClick", () => {
    it("returns the href for an Open citation link", () => {
      const anchor = document.createElement("a");
      anchor.href = "https://x.com/i/web/status/1";
      anchor.target = "_blank";
      const span = document.createElement("span");
      span.textContent = "Open →";
      anchor.appendChild(span);
      document.body.appendChild(anchor);

      const href = interceptAnchorClick({
        defaultPrevented: false,
        button: 0,
        target: span,
      });

      expect(href).toBe("https://x.com/i/web/status/1");
      document.body.removeChild(anchor);
    });

    it("ignores non-left clicks and already-handled events", () => {
      const anchor = document.createElement("a");
      anchor.href = "https://x.com/i/web/status/1";
      anchor.target = "_blank";
      expect(
        interceptAnchorClick({ defaultPrevented: true, button: 0, target: anchor }),
      ).toBeNull();
      expect(
        interceptAnchorClick({ defaultPrevented: false, button: 1, target: anchor }),
      ).toBeNull();
    });
  });

  describe("openExternalUrl", () => {
    const originalOpen = window.open;

    beforeEach(() => {
      mockInvoke.mockReset();
      delete (window as any).__TAURI_INTERNALS__;
      window.open = vi.fn();
    });

    afterEach(() => {
      window.open = originalOpen;
      delete (window as any).__TAURI_INTERNALS__;
    });

    it("invokes open_in_browser in Tauri", async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      mockInvoke.mockResolvedValueOnce(undefined);

      await openExternalUrl("https://x.com/i/web/status/1");

      expect(mockInvoke).toHaveBeenCalledWith("open_in_browser", {
        url: "https://x.com/i/web/status/1",
      });
    });

    it("prefixes relative URLs for the local desktop server", () => {
      expect(resolveExternalUrl("/api/x/oauth/start")).toBe("http://localhost:3000/api/x/oauth/start");
    });

    it("opens in a new tab on the web", async () => {
      await openExternalUrl("https://x.com/i/web/status/1");
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(window.open).toHaveBeenCalledWith(
        "https://x.com/i/web/status/1",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  describe("useTauriExternalLinks", () => {
    beforeEach(() => {
      mockInvoke.mockReset();
      delete (window as any).__TAURI_INTERNALS__;
    });

    afterEach(() => {
      delete (window as any).__TAURI_INTERNALS__;
    });

    it("does not attach a listener outside Tauri", () => {
      const add = vi.spyOn(document, "addEventListener");
      renderHook(() => useTauriExternalLinks());
      expect(add).not.toHaveBeenCalledWith("click", expect.any(Function), true);
      add.mockRestore();
    });

    it("opens citation links through Rust when running in Tauri", async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      mockInvoke.mockResolvedValueOnce(undefined);
      renderHook(() => useTauriExternalLinks());

      const anchor = document.createElement("a");
      anchor.href = "https://x.com/mario";
      anchor.target = "_blank";
      anchor.textContent = "Open →";
      document.body.appendChild(anchor);

      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      const prevented = !anchor.dispatchEvent(event);

      expect(prevented || event.defaultPrevented).toBe(true);
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("open_in_browser", {
          url: "https://x.com/mario",
        });
      });

      document.body.removeChild(anchor);
    });
  });
});

describe("isTauriRuntime", () => {
  it("detects the Tauri internals flag", () => {
    expect(isTauriRuntime(undefined)).toBe(false);
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
  });
});
