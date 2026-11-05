import { expect, test, type Locator } from "@playwright/test";

async function expectExchangeAfterMarkets(nav: Locator) {
  const links = await nav.locator("a").evaluateAll((items) => items.map((item) => ({
    href: item.getAttribute("href") ?? "",
    text: item.textContent?.trim() ?? "",
  })));
  const markets = links.findIndex((link) => /\/ru\/markets$/.test(link.href));
  const exchange = links.findIndex((link) => link.href.includes("/exchange/"));
  expect(markets).toBeGreaterThanOrEqual(0);
  expect(exchange).toBe(markets + 1);
  expect(links[exchange]?.text).toBe("Биржа");
}

test("global navigation uses the drawer below 1800px and full nav at 1800px", async ({ page }) => {
  const desktop = page.locator("header > div > nav").first();
  const openMenu = page.getByRole("button", { name: "Open menu" });
  const staticExchange = page.locator('header > div > a[href*="/exchange/"]');
  await page.setViewportSize({ width: 1024, height: 900 });
  const response = await page.goto("/ru/login", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  for (const width of [1024, 1440, 1800]) {
    await page.setViewportSize({ width, height: 900 });
    await expectExchangeAfterMarkets(desktop);
    if (width < 1800) {
      await expect(desktop).toBeHidden();
      await expect(staticExchange).toBeVisible();
      await expect(openMenu).toBeVisible();
      await openMenu.click();
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      await expectExchangeAfterMarkets(drawer);
      await expect(drawer.getByRole("link", { name: "Биржа", exact: true })).toBeVisible();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    } else {
      await expect(desktop).toBeVisible();
      await expect(staticExchange).toBeHidden();
      await expect(desktop.getByRole("link", { name: "Биржа", exact: true })).toBeVisible();
      await expect(openMenu).toBeHidden();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    }
    await page.screenshot({ path: `test-results/main-nav-${width}.png`, fullPage: true });
    if (width === 1024) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    }
  }

  await page.setViewportSize({ width: 1799, height: 900 });
  await expect(desktop).toBeHidden();
  await expect(staticExchange).toBeVisible();
  await expect(openMenu).toBeVisible();
  await page.screenshot({ path: "test-results/main-nav-1799.png", fullPage: true });
});
