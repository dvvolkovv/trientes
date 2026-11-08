import { expect, test } from "@playwright/test";

test("crypto map page renders a localized fallback when WebGL is unavailable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") return null;
      return (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof original;
  });

  const response = await page.goto("/en/crypto-map?coin=bitcoin", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  await expect(page.getByText(/^Map unavailable:.*WebGL2/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".maplibregl-map")).toHaveCount(0);
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  // The rest of the navigator is still there and usable.
  const satellite = page.getByRole("button", { name: "Satellite" });
  await expect(satellite).toBeVisible();
  await satellite.click();
  await expect(satellite).toHaveClass(/bg-foreground/);

  expect(pageErrors).toEqual([]);
});
