import { expect, test } from "@playwright/test";

test("seven linked guides render and return to Docs; recovery links select the right Settings tab", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const guides = [
    ["settings", "Settings"],
    ["connections", "Connecting your accounts"],
    ["llm", "Configure your AI (LLM)"],
    ["process-inbox", "Process inbox"],
    ["library", "Library reference"],
    ["setup", "Development environment setup"],
    ["agent-api", "Agent API"],
  ];
  await page.goto("/docs");
  for (const [path, title] of guides) {
    await page.locator(`main a[href="/docs/${path}"]`).filter({ has: page.locator("h3") }).click();
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "← Back to Docs", exact: true }).first().click();
    await expect(page).toHaveURL(/\/docs$/);
  }
  await page.locator('main a[href="/docs/connections"]').filter({ has: page.locator("h3") }).click();
  await page.locator('main a[href="/settings?tab=connections"]').click();
  await expect(page.getByRole("tab", { name: /^Connections/ })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});
