import { test, expect } from "@playwright/test";

test("bitcoin detail page renders chart and a price", async ({ page }) => {
  const response = await page.goto("/en/coin/bitcoin", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  // lightweight-charts mounts a <canvas> inside the chart container.
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Page should show a USD price like "$1,234" or "$12.34" somewhere prominent.
  const priceText = page.locator("body").getByText(/\$\s?\d[\d,]*\.?\d*/);
  await expect(priceText.first()).toBeVisible();
});
