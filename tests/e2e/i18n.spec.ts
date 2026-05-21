import { test, expect } from "@playwright/test";

test("locale routes serve content under /en and /de", async ({ page }) => {
  const en = await page.goto("/en", { waitUntil: "domcontentloaded" });
  expect(en?.status()).toBe(200);
  // Verify English locale content is rendered
  await expect(page.locator("nav")).toContainText("Exchanges");

  const de = await page.goto("/de", { waitUntil: "domcontentloaded" });
  expect(de?.status()).toBe(200);
  // Verify German locale content is rendered ("Exchanges" → "Börsen")
  await expect(page.locator("nav")).toContainText("Börsen");
});
