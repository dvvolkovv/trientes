import { build, type Plugin } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { tryCreateMap } from "../../src/lib/maplibre-map";

// Component harness in the style of maplibre-races.spec.ts, but with the REAL
// maplibre-gl 6 bundle: the point is to see how the components cope with the
// way MapLibre itself behaves when WebGL2 is missing or broken.
const root = process.cwd();
const ORIGIN = "http://map-fallback.test";

/** Globals the bundled entry below puts on `window`. */
type Harness = {
  __componentTest: { mountPoint(editing?: unknown): void; mountNavigator(): void; unmount(): void };
  __actions: unknown[];
  __tryCreateMap: typeof tryCreateMap;
};

const componentEntry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { PointForm } from "./src/components/business/point-form";
import CryptoNavigator from "./src/components/coin-detail/crypto-navigator";
import { tryCreateMap } from "./src/lib/maplibre-map";

globalThis.__actions = [];
globalThis.__tryCreateMap = tryCreateMap;
globalThis.__navigationControllers = [];
let root;
let host;
function mount(Component, props) {
  if (root) root.unmount();
  if (host) host.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(React.createElement(Component, props));
}
globalThis.__componentTest = {
  mountPoint(editing) {
    mount(PointForm, {
      companyId: "company-1",
      companyStatus: "APPROVED",
      coins: [],
      cards: [],
      companyAddress: { countryCode: "", city: "", street: "", houseNumber: "", postalCode: "" },
      editing: editing || undefined,
    });
  },
  mountNavigator() {
    mount(CryptoNavigator, { coinId: "bitcoin", symbol: "btc", coinName: "Bitcoin" });
  },
  unmount() {
    if (root) root.unmount();
    root = undefined;
  },
};
`;

async function bundle(): Promise<string> {
  const virtual = new Map<string, string>([
    ["next-intl", `
      export function useTranslations(namespace) {
        return (key) => namespace + "." + key;
      }
      export function useLocale() { return "en"; }
    `],
    ["next/navigation", `export function useRouter() { return { refresh() {} }; }`],
    ["@/app/actions/company", `
      export async function submitCompanyPoint(companyId, input) {
        globalThis.__actions.push({ action: "submit", companyId, input });
        return { ok: true };
      }
      export async function updateCompanyPoint(pointId, input) {
        globalThis.__actions.push({ action: "update", pointId, input });
        return { ok: true, moderated: false };
      }
    `],
    ["@/components/coin-detail/street-view-overlay", `export function StreetViewOverlay() { return null; }`],
    ["@/components/fintech/available-fintech-panel", `export function AvailableFintechPanel() { return null; }`],
    ["./navigation-controller", `
      export class NavigationController {
        constructor(route) { this.route = route; globalThis.__navigationControllers.push(this); }
        updateRoute() {}
        stop() { this.stopped = true; }
        async start() {}
      }
    `],
  ]);
  const plugin: Plugin = {
    name: "webgl-fallback-mocks",
    setup(build) {
      for (const id of virtual.keys()) {
        const filter = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`);
        build.onResolve({ filter }, () => ({ path: id, namespace: "virtual" }));
      }
      build.onResolve({ filter: /\.css$/ }, () => ({ path: "style", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => ({
        contents: virtual.get(args.path),
        loader: "js",
        resolveDir: root,
      }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    },
  };
  const result = await build({
    stdin: { contents: componentEntry, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "iife",
    write: false,
    plugins: [plugin],
  });
  return result.outputFiles[0].text;
}

/**
 * - no-webgl: the browser has no WebGL at all (webgl2, webgl and experimental-webgl → null).
 * - maplibre-context-null: a WebGL2 probe succeeds, but MapLibre's own canvas gets no
 *   context (blocklisted GPU / different attributes). MapLibre 6.4.1 then returns a
 *   half-initialised map instead of throwing.
 * - maplibre-context-throws: context creation on MapLibre's canvas throws, so
 *   `new Map(...)` itself throws.
 * In both of the latter the probe is answered by a stand-in context, so they reach
 * MapLibre on any machine, with or without a GPU (see expectMapLibreOutcome).
 */
const MODES = ["no-webgl", "maplibre-context-null", "maplibre-context-throws"] as const;
type WebglMode = (typeof MODES)[number];

/** Set by the init script in openHarness: how many times a page asked any canvas for "webgl2". */
type WebglCalls = { __webgl2Calls: number };

/** What tryCreateMap prints when MapLibre itself fails in each mode that gets that far. */
const MAPLIBRE_FAILURE_WARNING: Record<Exclude<WebglMode, "no-webgl">, RegExp> = {
  "maplibre-context-null": /^\[map\] MapLibre could not create a WebGL2 context$/,
  "maplibre-context-throws": /^\[map\] MapLibre failed to initialise .*WebGL2 context creation blocked/,
};

/**
 * Proves which branch of tryCreateMap a mode exercised. Without WebGL2 MapLibre is
 * never constructed. In the other modes the probe must pass and MapLibre must be
 * reached and fail (probe + MapLibre's own canvas = at least two webgl2 calls);
 * otherwise those modes would silently collapse into "no-webgl" on a machine
 * without a GPU.
 */
async function expectMapLibreOutcome(page: Page, mode: WebglMode) {
  if (mode === "no-webgl") {
    await expect.poll(() => mapWarnings(page)).toEqual([]);
    return;
  }
  const calls = await page.evaluate(() => (window as unknown as WebglCalls).__webgl2Calls);
  expect(calls, "the WebGL2 probe passed and MapLibre asked for its own context").toBeGreaterThanOrEqual(2);
  await expect.poll(() => mapWarnings(page)).toEqual([expect.stringMatching(MAPLIBRE_FAILURE_WARNING[mode])]);
}

let script: string;
test.beforeAll(async () => {
  script = await bundle();
});

const pageErrors = new WeakMap<Page, string[]>();
const pageWarnings = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  pageErrors.set(page, errors);
  pageWarnings.set(page, warnings);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

/** The console.warn lines tryCreateMap itself printed (they all start with "[map] "). */
function mapWarnings(page: Page): string[] {
  return (pageWarnings.get(page) ?? []).filter((text) => text.startsWith("[map] "));
}

const PRAHA = [{ lat: 50.0755, lon: 14.4378, label: "Praha" }];

/**
 * "native" leaves the browser's WebGL alone; the other modes break it as described above.
 * `geocodeResults` is what /api/crypto-map/geocode answers to every address lookup.
 */
async function openHarness(
  page: Page,
  mode: WebglMode | "native",
  { geocodeResults = PRAHA }: { geocodeResults?: unknown[] } = {},
) {
  await page.addInitScript((mode: WebglMode | "native") => {
    if (mode === "native") return;
    const counter = window as unknown as WebglCalls;
    counter.__webgl2Calls = 0;
    // Everything supportsWebGL2() does with the context it gets: free it again.
    const probeContext = {
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext() {} } : null),
    };
    const original = HTMLCanvasElement.prototype.getContext;
    const webglTypes = new Set(["webgl2", "webgl", "experimental-webgl"]);
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2") counter.__webgl2Calls += 1;
      if (webglTypes.has(type)) {
        const mapCanvas = this.classList.contains("maplibregl-canvas");
        if (mode === "no-webgl") return null;
        // The first webgl2 call is the supportsWebGL2() probe. Serve it a stand-in
        // so it passes with or without a GPU; only the calls after it (MapLibre's
        // own canvas) are broken below.
        if (type === "webgl2" && counter.__webgl2Calls === 1) return probeContext as unknown as WebGL2RenderingContext;
        if (mode === "maplibre-context-null" && mapCanvas) return null;
        if (mode === "maplibre-context-throws" && mapCanvas) throw new Error("WebGL2 context creation blocked");
      }
      return (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof original;
  }, mode);

  const api: string[] = [];
  const external: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
      });
    }
    api.push(url.pathname + url.search);
    if (url.pathname === "/api/crypto-map/geocode" && url.searchParams.has("q")) {
      return route.fulfill({ json: { results: geocodeResults } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ content: script });
  return { api, external };
}

// Positive contract of tryCreateMap with the real MapLibre bundle. tryCreateMap
// tells a failed WebGL2 start by the missing `map.painter`, a MapLibre internal.
// Every other test here only covers the failures, so if an upgrade renamed the
// painter or set it up asynchronously, they would all stay green while every
// user lost the map. Run this test first when upgrading maplibre-gl. It needs
// real WebGL2 (GPU or SwiftShader) and fails, not skips, without it.
test("tryCreateMap returns a working map with the real MapLibre bundle (contract)", async ({ page }) => {
  const { external } = await openHarness(page, "native");
  const webgl2 = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  });
  expect(webgl2, "contract test requires WebGL2 (SwiftShader/GPU)").toBe(true);

  const result = await page.evaluate(() => {
    const container = document.createElement("div");
    container.style.width = "320px";
    container.style.height = "240px";
    document.body.appendChild(container);
    const map = (window as unknown as Harness).__tryCreateMap({ container, attributionControl: false });
    if (!map) return null;

    const canvas = map.getCanvas();
    // getContext on a canvas that already has a WebGL2 context returns that context.
    const gl = canvas.getContext("webgl2");
    const created = {
      painter: Boolean(map.painter),
      mapClass: container.classList.contains("maplibregl-map"),
      canvases: [...container.querySelectorAll("canvas")].map((element) => element.className),
      canvasIsTheMapCanvas: container.querySelector("canvas.maplibregl-canvas") === canvas,
      webgl2Context: gl instanceof WebGL2RenderingContext,
    };
    let removeEvent = false;
    map.on("remove", () => {
      removeEvent = true;
    });
    map.remove();
    // What MapLibre 6.4.1 remove() guarantees: it detaches its canvas and control
    // containers, drops the maplibregl-map class, loses the WebGL context
    // (WEBGL_lose_context) and fires "remove". The container element itself
    // belongs to the caller and stays.
    const removed = {
      removeEvent,
      children: container.childElementCount,
      className: container.className,
      contextLost: gl?.isContextLost() ?? null,
      containerAttached: container.isConnected,
    };
    container.remove();
    return { created, removed };
  });

  expect(result, "tryCreateMap returned null although WebGL2 works").not.toBeNull();
  expect(result).toEqual({
    created: {
      painter: true,
      mapClass: true,
      canvases: ["maplibregl-canvas"],
      canvasIsTheMapCanvas: true,
      webgl2Context: true,
    },
    removed: {
      removeEvent: true,
      children: 0,
      className: "",
      contextLost: true,
      containerAttached: true,
    },
  });
  expect(mapWarnings(page)).toEqual([]);
  expect(external).toEqual([]);
});

for (const mode of MODES) {
  test(`crypto navigator renders a fallback instead of the map (${mode})`, async ({ page }) => {
    const { api, external } = await openHarness(page, mode);
    await page.evaluate(() => (window as unknown as Harness).__componentTest.mountNavigator());

    await expect(page.getByText("cryptoMap.mapUnavailable")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.locator(".maplibregl-map")).toHaveCount(0);
    await expectMapLibreOutcome(page, mode);

    // Everything that is not the map itself keeps working without one.
    const threeD = page.getByRole("button", { name: "cryptoMap.threeD" });
    await threeD.click();
    await expect(threeD).toHaveClass(/bg-foreground/);
    const satellite = page.getByRole("button", { name: "cryptoMap.satellite" });
    await satellite.click();
    await expect(satellite).toHaveClass(/bg-foreground/);
    const car = page.getByRole("button", { name: "🚗 cryptoMap.mode_car" });
    await car.click();
    await expect(car).toHaveClass(/bg-foreground/);
    const coinOnly = page.getByTitle("cryptoMap.coinOnlyHint");
    await coinOnly.click();
    await expect(coinOnly).toContainText("✓");
    const atm = page.getByRole("button", { name: /cryptoMap\.layer_atm/ });
    await atm.click();
    await expect(atm).toHaveClass(/text-muted\/40/);
    await page.getByPlaceholder("cryptoMap.searchPlaceholder").fill("Praha");
    await page.getByRole("button", { name: "cryptoMap.search", exact: true }).click();
    await expect.poll(() => api.some((url) => url.startsWith("/api/crypto-map/geocode?q="))).toBe(true);
    await page.getByRole("button", { name: /cryptoMap\.posAuto/ }).click();

    await page.evaluate(() => (window as unknown as Harness).__componentTest.unmount());
    await expect(page.getByText("cryptoMap.mapUnavailable")).toHaveCount(0);
    // No style, tile or worker requests: MapLibre never got far enough to load anything.
    expect(external).toEqual([]);
  });
}

test("point form without WebGL places a new point from its address and submits it", async ({ page }) => {
  const { external } = await openHarness(page, "no-webgl");
  await page.evaluate(() => (window as unknown as Harness).__componentTest.mountPoint());

  await expect(page.getByText("business.mapUnavailable")).toBeVisible();
  // The "click the map" hint makes no sense when there is no map.
  await expect(page.getByText("business.clickMapToPlace")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);

  const submit = page.getByRole("button", { name: "business.submitPoint" });
  await expect(submit).toBeDisabled();
  await page.getByPlaceholder("business.pointName").fill("Crypto café");
  await page.locator("select").first().selectOption("CZ");
  await page.getByPlaceholder("business.city").fill("Praha");
  await page.getByPlaceholder("business.street").fill("Václavské náměstí");
  await page.getByPlaceholder("business.houseNumber").fill("1");

  await expect(page.getByText("business.geocodingOk")).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("business.pointSubmitted")).toBeVisible();

  const actions = await page.evaluate(() => (window as unknown as Harness).__actions);
  expect(actions).toEqual([
    {
      action: "submit",
      companyId: "company-1",
      input: expect.objectContaining({
        type: "SHOP",
        name: "Crypto café",
        countryCode: "CZ",
        city: "Praha",
        street: "Václavské náměstí",
        houseNumber: "1",
        lat: 50.0755,
        lon: 14.4378,
      }),
    },
  ]);
  expect(external).toEqual([]);
});

test("point form without WebGL asks for a better address when geocoding finds nothing", async ({ page }) => {
  const { api, external } = await openHarness(page, "no-webgl", { geocodeResults: [] });
  await page.evaluate(() => (window as unknown as Harness).__componentTest.mountPoint());

  await expect(page.getByText("business.mapUnavailable")).toBeVisible();
  await page.getByPlaceholder("business.pointName").fill("Crypto café");
  await page.locator("select").first().selectOption("CZ");
  await page.getByPlaceholder("business.city").fill("Praha");
  await page.getByPlaceholder("business.street").fill("Neexistující");
  await page.getByPlaceholder("business.houseNumber").fill("999");

  // There is no map to put the pin on, so the hint must point at the address instead.
  await expect(page.getByText("business.geocodingFailedNoMap")).toBeVisible();
  await expect(page.getByText(/business\.geocodingFailed$/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "business.submitPoint" })).toBeDisabled();
  expect(api.filter((url) => url.startsWith("/api/crypto-map/geocode?q="))).not.toEqual([]);
  expect(external).toEqual([]);
});

const editing = {
  id: "point-1",
  type: "SHOP",
  name: "Existing shop",
  countryCode: "CZ",
  city: "Praha",
  street: "Na Příkopě",
  houseNumber: "10",
  postalCode: "11000",
  lat: 50.0853,
  lon: 14.4262,
  acceptedCoinIds: [],
  acceptedCardIds: [],
  photos: [],
};

for (const mode of MODES) {
  test(`point form without a map keeps and saves existing coordinates (${mode})`, async ({ page }) => {
    const { api, external } = await openHarness(page, mode);
    await page.evaluate((point) => (window as unknown as Harness).__componentTest.mountPoint(point), editing);

    await expect(page.getByText("business.mapUnavailable")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expectMapLibreOutcome(page, mode);

    // SHOP → ONLINE → SHOP must neither crash nor resurrect a broken map.
    await page.getByRole("button", { name: "business.type.ONLINE" }).click();
    await expect(page.getByText("business.mapUnavailable")).toHaveCount(0);
    await page.getByRole("button", { name: "business.type.SHOP" }).click();
    await expect(page.getByText("business.mapUnavailable")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    const save = page.getByRole("button", { name: "business.savePoint" });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText("business.pointSaved")).toBeVisible();

    const actions = await page.evaluate(() => (window as unknown as Harness).__actions);
    expect(actions).toEqual([
      {
        action: "update",
        pointId: "point-1",
        input: expect.objectContaining({ type: "SHOP", name: "Existing shop", lat: 50.0853, lon: 14.4262 }),
      },
    ]);
    // The existing pin was not re-geocoded away from where the owner put it.
    expect(api.filter((url) => url.startsWith("/api/crypto-map/geocode"))).toEqual([]);

    await page.evaluate(() => (window as unknown as Harness).__componentTest.unmount());
    expect(external).toEqual([]);
  });
}
