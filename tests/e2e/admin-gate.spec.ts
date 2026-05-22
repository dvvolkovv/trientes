import { test, expect } from "@playwright/test";

test("anonymous user cannot reach /admin/* (middleware bounces)", async ({ page }) => {
  // Don't set a cookie — browser context is fresh per test.
  await page.goto("/en/admin/coins", { waitUntil: "domcontentloaded" });

  // After all redirects, URL must no longer be in /admin/.
  const finalUrl = page.url();
  expect(finalUrl).not.toContain("/admin/");
});
