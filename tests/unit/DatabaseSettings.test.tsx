import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSettings } from "@/app/components/settings/DatabaseSettings";

vi.mock("@/app/hooks/settings/useDatabaseSettings", () => ({
  useDatabaseSettings: () => ({
    backups: [],
    loading: false,
    creating: false,
    restoring: false,
    clearing: false,
    createLocalBackup: vi.fn(),
    deleteLocalBackup: vi.fn(),
    restoreLocalBackup: vi.fn(),
    restoreFromUpload: vi.fn(),
    clearData: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("DatabaseSettings download name", () => {
  it("passes the current custom name as a single encoded query parameter", () => {
    render(<DatabaseSettings />);
    const input = screen.getByPlaceholderText("e.g. before_enrichment");
    const link = screen.getByRole("link", { name: "Download active database (.db)" });

    for (const customName of ["before_enrichment", "backup & notes?#.db", ""]) {
      fireEvent.change(input, { target: { value: customName } });
      const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
      expect(url.pathname).toBe("/api/settings/database/backup");
      expect(url.searchParams.get("customName")).toBe(customName);
      expect(url.searchParams.get("includeSecrets")).toBe("false");
      expect(url.hash).toBe("");
      expect(link).toHaveAttribute("download");
    }
    fireEvent.change(input, { target: { value: "named.db" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include API keys and account tokens in download" }));
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.searchParams.get("customName")).toBe("named.db");
    expect(url.searchParams.get("includeSecrets")).toBe("true");
  });
});
