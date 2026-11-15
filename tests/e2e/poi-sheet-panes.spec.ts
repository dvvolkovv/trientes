import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Карточка точки как листалка.
 *
 * Точки навигатора рисует слой карты, а не DOM, поэтому кликнуть по имени
 * нельзя — кликаем по полотну. Чтобы клик попадал всегда, фид точек
 * подменяется одной точкой ровно в середине запрошенного окна: середина окна
 * и есть центр карты, то есть середина полотна.
 */
const PAGE = "/ru/coin/bitcoin#map";

const POINT = {
  id: "node/1",
  name: "Кафе на проверку",
  layer: "merchant",
  category: "Cafe",
  address: "Прага, Староместская площадь 1",
  lightning: true,
  coinSpecific: true,
  acceptedCoins: [{ symbol: "BTC", name: "Bitcoin", slug: "bitcoin", logoUrl: null, own: false }],
  acceptedGeneric: false,
  photos: [],
  website: "https://example.org",
  openingHours: "Mo-Su 09:00-21:00",
  phone: "+420123456789",
  email: null,
  socials: [],
  image: null,
  description: "Точка для e2e-прогона листалки.",
};

async function stubFeed(page: Page) {
  await page.route("**/api/crypto-map/poi*", async (route) => {
    const bbox = new URL(route.request().url()).searchParams.get("bbox") ?? "";
    const [w, s, e, n] = bbox.split(",").map(Number);
    const pois = [{ ...POINT, lon: (w + e) / 2, lat: (s + n) / 2 }];
    await route.fulfill({ json: { pois } });
  });
}

async function openPoi(page: Page) {
  await stubFeed(page);
  await page.goto(PAGE);
  const canvas = page.locator("canvas.maplibregl-canvas");
  await canvas.waitFor({ timeout: 30_000 });
  // Карта лежит далеко внизу страницы монеты, а клик мышью идёт по окну —
  // без прокрутки середина полотна оказывается за пределами видимого.
  await canvas.scrollIntoViewIfNeeded();
  // Фид уже подменён, но точка появляется после ответа — клик повторяется,
  // пока слой не отрисован.
  await expect(async () => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error("нет полотна карты");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("карточка точки — три страницы", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("открывается на фактах, а не на карте", async ({ page }) => {
    await openPoi(page);
    await expect(page.getByRole("tab", { name: "Место" })).toHaveAttribute("aria-selected", "true");
  });

  test("индикатор листает без жеста", async ({ page }) => {
    await openPoi(page);
    await page.getByRole("tab", { name: "Карта" }).click();
    await expect(page.getByRole("tab", { name: "Карта" })).toHaveAttribute("aria-selected", "true");
    // На странице карты видна полоса управления маршрутом.
    await expect(page.getByRole("button", { name: /Маршрут|Поехали/ }).first()).toBeVisible();
  });

  test("витрина показывает контент заведения", async ({ page }) => {
    await openPoi(page);
    await page.getByRole("tab", { name: "Витрина" }).click();
    await expect(page.getByRole("tab", { name: "Витрина" })).toHaveAttribute("aria-selected", "true");
    // Ищем внутри карточки: у самой страницы монеты тоже есть ссылка «Сайт».
    await expect(page.getByRole("dialog").getByRole("link", { name: "Сайт" })).toBeVisible();
  });

  test("на странице карты палец достаёт до карты", async ({ page }) => {
    await openPoi(page);
    await page.getByRole("tab", { name: "Карта" }).click();
    const before = await page.evaluate(() => document.querySelectorAll("canvas.maplibregl-canvas").length);
    expect(before).toBe(1);
    // Перетаскивание середины страницы карты не перелистывает её.
    await page.mouse.move(195, 480);
    await page.mouse.down();
    await page.mouse.move(60, 480, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByRole("tab", { name: "Карта" })).toHaveAttribute("aria-selected", "true");
    // И полотно то же самое — карта не пересоздавалась.
    expect(await page.evaluate(() => document.querySelectorAll("canvas.maplibregl-canvas").length)).toBe(1);
  });
});

test.describe("карточка точки на десктопе", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("страниц две, карты среди них нет", async ({ page }) => {
    await openPoi(page);
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("tab", { name: "Карта" })).toHaveCount(0);
  });
});
