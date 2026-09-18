import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DatabaseSettings } from "@/app/components/settings/DatabaseSettings";

vi.mock("@/app/hooks/settings/useDatabaseSettings", () => ({
  useDatabaseSettings: () => ({ backups: [], loading: false }),
}));

it("downloads without credentials unless the user explicitly opts in", () => {
  render(<DatabaseSettings />);
  fireEvent.click(screen.getByText("Database management"));
  const checkbox = screen.getByRole("checkbox", { name: "Include API keys and account tokens in download" });
  const link = screen.getByRole("link", { name: "Download active database (.db)" });
  expect(checkbox).not.toBeChecked();
  expect(link).toHaveAttribute("href", "/api/settings/database/backup?includeSecrets=false");
  fireEvent.click(checkbox);
  expect(link).toHaveAttribute("href", "/api/settings/database/backup?includeSecrets=true");
  expect(screen.getByText(/Anyone with this file can use your connected accounts/)).toBeVisible();
  fireEvent.click(checkbox);
  expect(link).toHaveAttribute("href", "/api/settings/database/backup?includeSecrets=false");
});
