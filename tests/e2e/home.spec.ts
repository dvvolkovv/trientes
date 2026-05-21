import { test, expect } from "@playwright/test";

test("home page renders top-coin table with at least 10 rows", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const response = await page.goto("/en", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  // Table proper — top-coins list. Match by role, not by class.
  const table = page.getByRole("table").first();
  await expect(table).toBeVisible();

  const rowCount = await table.locator("tbody tr").count();
  expect(rowCount).toBeGreaterThanOrEqual(10);

  // SSE/live-tick errors are noisy in the browser but should not throw.
  // Filter benign third-party errors and assert no real ones remain.
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|EventSource|ChunkLoadError/i.test(e)
  );
  expect(realErrors, realErrors.join("\n")).toEqual([]);
});
