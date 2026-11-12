import { test, expect } from "@playwright/test";

// Transparent 1×1 RGBA PNG.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);

test("home page renders top-coin table with at least 10 rows", async ({ page, baseURL }) => {
  // /uploads/ is filled at runtime (coin-card logos and other user uploads) and
  // is gitignored, so a clean checkout 404s on it. Serve a real image for our
  // own origin only; third-party URLs that merely contain /uploads/ (news
  // thumbnails) load as usual.
  const origin = new URL(baseURL!).origin;
  await page.route("**/uploads/**", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || !url.pathname.startsWith("/uploads/")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL_PNG });
  });

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

test("coin icons come from our own origin, not a third-party CDN", async ({ page }) => {
  await page.goto("/en", { waitUntil: "domcontentloaded" });

  const table = page.getByRole("table").first();
  await expect(table).toBeVisible();

  const srcs = await table
    .locator("tbody tr img")
    .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src") ?? ""));
  expect(srcs.length).toBeGreaterThanOrEqual(10);

  // A logo served straight from coin-images.coingecko.com is only as reachable
  // as that CDN is from the visitor's network; ours is as reachable as the page
  // they are already looking at.
  const external = srcs.filter((s) => /^https?:\/\//.test(s));
  expect(external, external.join("\n")).toEqual([]);
});
