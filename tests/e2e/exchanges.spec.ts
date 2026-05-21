import { test, expect } from "@playwright/test";

test("exchanges page renders ≥10 exchange rows", async ({ page }) => {
  const response = await page.goto("/en/exchanges", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const table = page.getByRole("table").first();
  await expect(table).toBeVisible();

  const rowCount = await table.locator("tbody tr").count();
  expect(rowCount).toBeGreaterThanOrEqual(10);
});
