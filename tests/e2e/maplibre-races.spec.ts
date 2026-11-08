import path from "node:path";
import { build, type Plugin } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

const root = process.cwd();

const maplibreMock = `
class EventTarget {
  constructor() { this.handlers = new globalThis.Map(); }
  on(event, layerOrHandler, maybeHandler) {
    const layered = typeof layerOrHandler === "function" ? null : layerOrHandler;
    const handler = layered === null ? layerOrHandler : maybeHandler;
    const key = layered === null ? event : event + ":" + layered;
    const handlers = this.handlers.get(key) || [];
    handlers.push(handler);
    this.handlers.set(key, handlers);
    return this;
  }
  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }
  off(event, layerOrHandler, maybeHandler) {
    const layered = typeof layerOrHandler === "function" ? null : layerOrHandler;
    const handler = layered === null ? layerOrHandler : maybeHandler;
    const key = layered === null ? event : event + ":" + layered;
    const handlers = this.handlers.get(key) || [];
    this.handlers.set(key, handlers.filter((candidate) => candidate !== handler));
    return this;
  }
  emit(event, layerOrPayload, maybePayload) {
    const layered = typeof layerOrPayload === "string";
    const key = layered ? event + ":" + layerOrPayload : event;
    const payload = layered ? maybePayload : layerOrPayload;
    if (event === "load") this.styleLoaded = true;
    for (const handler of [...(this.handlers.get(key) || [])]) handler(payload);
  }
}

class Source {
  constructor(specification) { this.specification = specification; this.data = specification.data; }
  setData(data) { this.data = data; }
}

export class Map extends EventTarget {
  constructor(options) {
    super();
    this.options = options;
    this.container = options.container;
    // A MapLibre map that got its WebGL2 context has a painter; tryCreateMap checks it.
    this.painter = {};
    this.sources = new globalThis.Map();
    this.layers = new globalThis.Map();
    this.filterCalls = [];
    this.layoutCalls = [];
    this.terrainCalls = [];
    this.flyToCalls = [];
    this.easeToCalls = [];
    this.removed = false;
    this.styleLoaded = false;
    globalThis.__maps.push(this);
  }
  addControl() { return this; }
  addSource(id, specification) { this.sources.set(id, new Source(specification)); }
  getSource(id) { return this.sources.get(id); }
  addLayer(layer) { this.layers.set(layer.id, layer); }
  getLayer(id) { return this.layers.get(id); }
  assertStyleLayer(method, id) {
    if (!this.styleLoaded) throw new Error(method + " before style load: " + id);
    if (!this.layers.has(id)) throw new Error(method + " before layer creation: " + id);
  }
  setFilter(id, filter) {
    this.assertStyleLayer("setFilter", id);
    this.filterCalls.push({ id, filter });
  }
  setLayoutProperty(id, name, value) {
    this.assertStyleLayer("setLayoutProperty", id);
    this.layoutCalls.push({ id, name, value });
  }
  getZoom() { return 13; }
  getBounds() {
    return { getWest: () => 14, getSouth: () => 50, getEast: () => 15, getNorth: () => 51 };
  }
  getCenter() { return { lng: 14.42, lat: 50.08 }; }
  getCanvas() { return { style: {} }; }
  queryRenderedFeatures() { return []; }
  fitBounds() {}
  flyTo(options) { this.flyToCalls.push(options); }
  easeTo(options) { this.easeToCalls.push(options); }
  setTerrain(options) {
    if (!this.styleLoaded) throw new Error("setTerrain before style load");
    if (options && !this.sources.has(options.source)) throw new Error("setTerrain before source creation: " + options.source);
    this.terrainCalls.push(options);
  }
  isStyleLoaded() { return this.styleLoaded; }
  loaded() { return this.styleLoaded; }
  remove() { this.removed = true; }
}

export class GeolocateControl extends EventTarget {
  constructor(options) { super(); this.options = options; globalThis.__geolocates.push(this); }
}
export class NavigationControl { constructor(options) { this.options = options; } }
export class Marker {
  constructor(options = {}) { this.options = options; globalThis.__markers.push(this); }
  setLngLat(lonlat) { this.lonlat = lonlat; return this; }
  addTo(map) { this.map = map; return this; }
  getLngLat() { return { lng: this.lonlat[0], lat: this.lonlat[1] }; }
  on() { return this; }
  remove() { this.removed = true; }
}
export class Popup {
  constructor(options) { this.options = options; globalThis.__popups.push(this); }
  setLngLat(lonlat) { this.lonlat = lonlat; return this; }
  setDOMContent(content) { this.content = content; return this; }
  addTo(map) { this.map = map; return this; }
  remove() { this.removed = true; }
}
export class LngLatBounds {
  constructor(sw, ne) { this.sw = sw; this.ne = ne; }
  extend() { return this; }
}
export function setWorkerUrl() {}
`;

const componentEntry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { PointForm } from "./src/components/business/point-form";
import CryptoNavigator from "./src/components/coin-detail/crypto-navigator";
import { CryptoMapSection } from "./src/components/coin-detail/crypto-map-section";

globalThis.__maps = [];
globalThis.__geolocates = [];
globalThis.__popups = [];
globalThis.__markers = [];
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
  mountPoint() {
    mount(PointForm, {
      companyId: "company-1",
      companyStatus: "APPROVED",
      coins: [],
      cards: [],
      companyAddress: { countryCode: "", city: "", street: "", houseNumber: "", postalCode: "" },
    });
  },
  mountNavigator() {
    mount(CryptoNavigator, { coinId: "bitcoin", symbol: "btc", coinName: "Bitcoin" });
  },
  renderMapSection(coinId) {
    const props = { coinId, symbol: coinId === "bitcoin" ? "btc" : "eth", coinName: coinId };
    if (!root) {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
    }
    root.render(React.createElement(CryptoMapSection, props));
  },
  unmount() { if (root) root.unmount(); },
};
`;

async function bundle(): Promise<string> {
  const virtual = new Map<string, string>([
    ["maplibre-gl", maplibreMock],
    ["next-intl", `
      export function useTranslations(namespace) {
        return (key) => namespace + "." + key;
      }
      export function useLocale() { return "en"; }
    `],
    ["next/navigation", `export function useRouter() { return { refresh() {} }; }`],
    // MapLibre is mocked above, so the real WebGL2 probe must not decide whether
    // the mock map gets created: without a GPU (or with --disable-3d-apis) it
    // would return false and every test here would time out waiting for a map.
    ["@/lib/webgl-support", "export const supportsWebGL2 = () => true;"],
    ["next/dynamic", `
      import CryptoNavigator from "@/components/coin-detail/crypto-navigator";
      export default function dynamic() { return CryptoNavigator; }
    `],
    ["@/app/actions/company", `
      export async function submitCompanyPoint() { return {}; }
      export async function updateCompanyPoint() { return {}; }
    `],
    ["@/components/coin-detail/street-view-overlay", `export function StreetViewOverlay() { return null; }`],
    ["@/components/fintech/available-fintech-panel", `export function AvailableFintechPanel() { return null; }`],
    ["./navigation-controller", `
      export class NavigationController {
        constructor(route) { this.route = route; this.startCalls = 0; globalThis.__navigationControllers.push(this); }
        updateRoute() {}
        stop() { this.stopped = true; }
        async start() { this.startCalls += 1; }
      }
    `],
  ]);
  const plugin: Plugin = {
    name: "component-test-mocks",
    setup(build) {
      build.onResolve({ filter: /^maplibre-gl$/ }, () => ({ path: "maplibre-gl", namespace: "virtual" }));
      build.onResolve({ filter: /^next-intl$/ }, () => ({ path: "next-intl", namespace: "virtual" }));
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next/navigation", namespace: "virtual" }));
      build.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: "next/dynamic", namespace: "virtual" }));
      // src/lib/maplibre-map.ts imports it as "./webgl-support": catch every
      // spelling that resolves to src/lib/webgl-support.
      build.onResolve({ filter: /(^|\/)webgl-support$/ }, (args) => {
        const target = args.path.startsWith("@/")
          ? path.join(root, "src", args.path.slice(2))
          : path.resolve(args.resolveDir, args.path);
        if (target !== path.join(root, "src/lib/webgl-support")) return undefined;
        return { path: "@/lib/webgl-support", namespace: "virtual" };
      });
      build.onResolve({ filter: /^@\/app\/actions\/company$/ }, () => ({ path: "@/app/actions/company", namespace: "virtual" }));
      build.onResolve({ filter: /^@\/components\/coin-detail\/street-view-overlay$/ }, () => ({ path: "@/components/coin-detail/street-view-overlay", namespace: "virtual" }));
      build.onResolve({ filter: /^@\/components\/fintech\/available-fintech-panel$/ }, () => ({ path: "@/components/fintech/available-fintech-panel", namespace: "virtual" }));
      build.onResolve({ filter: /^\.\/navigation-controller$/ }, () => ({ path: "./navigation-controller", namespace: "virtual" }));
      build.onResolve({ filter: /\.css$/ }, () => ({ path: "style", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => ({ contents: virtual.get(args.path), loader: "js", resolveDir: root }));
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

let script: string;
test.beforeAll(async () => {
  script = await bundle();
});

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function setupPage(page: Page) {
  // The bundle mocks maplibre-gl and the WebGL2 probe, so nothing here needs a
  // WebGL context. Take WebGL away anyway: if either mock stopped applying, the
  // real probe or MapLibre would get no context and every test here would fail
  // on every machine, instead of passing wherever a GPU or SwiftShader happens
  // to provide one.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2" || type === "webgl") return null;
      return (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof original;
    Object.assign(window, { __webglDenied: true });
  });
  await page.goto("about:blank");
  // Not vacuous: the init script above ran in this document.
  expect(await page.evaluate(() => "__webglDenied" in window), "WebGL denied before the bundle loads").toBe(true);
  expect(
    await page.evaluate(() =>
      ["webgl2", "webgl"].map((type) => document.createElement("canvas").getContext(type) === null),
    ),
    "no WebGL context for the bundle",
  ).toEqual([true, true]);
  await page.evaluate(() => {
    const requests: unknown[] = [];
    Object.assign(window, { __requests: requests });
    window.fetch = (input, init) => new Promise((resolve, reject) => {
      requests.push({
        url: String(input),
        signal: init?.signal,
        resolve: (body: unknown, ok = true) => resolve({ ok, json: async () => body } as Response),
        reject,
      });
    });
  });
  await page.addScriptTag({ content: script });
}

async function mountNavigator(page: Page) {
  await setupPage(page);
  await page.evaluate(() => (window as any).__componentTest.mountNavigator());
  await page.waitForFunction(() => (window as any).__maps.length === 1);
}

async function loadMap(page: Page, index = 0) {
  await page.evaluate((mapIndex) => (window as any).__maps[mapIndex].emit("load"), index);
  await page.waitForFunction((mapIndex) => (window as any).__maps[mapIndex].sources.has("pois"), index);
}

async function startFirstRoute(page: Page, startNavigation = false) {
  await page.evaluate((startNavigation) => {
    const map = (window as any).__maps[0];
    map.emit("click", { lngLat: { lng: 14.4, lat: 50.1 }, point: { x: 0, y: 0 } });
    map.emit("click", "poi-merchant", {
      features: [{
        geometry: { type: "Point", coordinates: [14.5, 50.2] },
        properties: {
          id: "destination", lat: 50.2, lon: 14.5, name: "Destination", layer: "merchant",
          category: "shop", address: null, lightning: false, coinSpecific: true,
          website: null, openingHours: null, phone: null, email: null,
          socials: "[]", image: null, description: null,
        },
      }],
    });
    const popup = (window as any).__popups.at(-1);
    popup.content.querySelector(startNavigation ? ".cmap-start" : ".cmap-route").click();
  }, startNavigation);
  await page.waitForFunction(() => (window as any).__requests.filter((r: any) => r.url.includes("/directions?")).length === 1);
}

const oldPoi = {
  id: "old", lat: 50.01, lon: 14.01, name: "Old POI", layer: "merchant", category: "shop",
  address: null, lightning: false, coinSpecific: false, website: null, openingHours: null,
  phone: null, email: null, socials: [], image: null, description: null,
};
const newPoi = { ...oldPoi, id: "new", name: "New POI", coinSpecific: true };

function route(distance: number, mode: "walk" | "car", lastLon: number) {
  return {
    distance,
    duration: distance / 2,
    mode,
    geometry: { type: "LineString", coordinates: [[14.4, 50.1], [lastLon, 50.3]] },
  };
}

async function settleDirections(page: Page, index: number, outcome: "resolve" | "reject") {
  await page.evaluate(({ index, outcome }) => {
    const request = (window as any).__requests.filter((r: any) => r.url.includes("/directions?"))[index];
    if (outcome === "resolve") request.resolve({ distance: 1000, duration: 500, mode: "walk", geometry: { type: "LineString", coordinates: [[14.4, 50.1], [14.5, 50.2]] } });
    else request.reject(new Error("late network failure"));
  }, { index, outcome });
}

async function startPendingSecondRoute(page: Page) {
  await startFirstRoute(page);
  await settleDirections(page, 0, "resolve");
  await page.waitForFunction(() => (window as any).__maps[0].sources.get("route").data.features.length === 1);
  await page.getByRole("button", { name: "🚗 cryptoMap.mode_car" }).click();
  await page.waitForFunction(() => (window as any).__requests.filter((r: any) => r.url.includes("/directions?")).length === 2);
}

test("SHOP → ONLINE → SHOP removes and recreates the point map", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: script });
  await page.evaluate(() => (window as any).__componentTest.mountPoint());
  await page.waitForFunction(() => (window as any).__maps.length === 1);

  await page.getByRole("button", { name: "business.type.ONLINE" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__maps[0].removed)).toBe(true);
  await page.getByRole("button", { name: "business.type.SHOP" }).click();
  await page.waitForFunction(() => (window as any).__maps.length === 2);
  expect(await page.evaluate(() => (window as any).__maps[1].removed)).toBe(false);
});

test("SHOP → ATM keeps the same point map instance", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: script });
  await page.evaluate(() => (window as any).__componentTest.mountPoint());
  await page.waitForFunction(() => (window as any).__maps.length === 1);

  await page.getByRole("button", { name: "business.type.ATM" }).click();
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (window as any).__maps.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__maps[0].removed)).toBe(false);
});

test("user coordinates survive ONLINE → SHOP map recreation", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: script });
  await page.evaluate(() => (window as any).__componentTest.mountPoint());
  await page.waitForFunction(() => (window as any).__maps.length === 1);
  await page.evaluate(() => (window as any).__maps[0].emit("click", { lngLat: { lng: 14.6, lat: 50.2 } }));
  await page.waitForFunction(() => (window as any).__markers.some((marker: any) => marker.lonlat?.[0] === 14.6));

  await page.getByRole("button", { name: "business.type.ONLINE" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__maps[0].removed)).toBe(true);
  await page.getByRole("button", { name: "business.type.SHOP" }).click();
  await page.waitForFunction(() => (window as any).__maps.length === 2);
  await page.evaluate(() => (window as any).__maps[1].emit("load"));
  await page.waitForFunction(() => (window as any).__markers.some((marker: any) => marker.map === (window as any).__maps[1]));
  expect(await page.evaluate(() => (window as any).__markers.find((marker: any) => marker.map === (window as any).__maps[1]).lonlat)).toEqual([14.6, 50.2]);
});

test("coinOnly waits for style load and applies the latest filter to all POI layers", async ({ page }) => {
  await mountNavigator(page);
  await page.getByTitle("cryptoMap.coinOnlyHint").click();
  await page.getByTitle("cryptoMap.coinOnlyHint").click();
  await page.getByTitle("cryptoMap.coinOnlyHint").click();
  expect(await page.evaluate(() => (window as any).__maps[0].filterCalls.length)).toBe(0);

  await loadMap(page);
  const calls = await page.evaluate(() => (window as any).__maps[0].filterCalls);
  expect(calls).toHaveLength(4);
  expect(calls.map((call: any) => call.id).sort()).toEqual(["poi-atm", "poi-financial", "poi-fintech", "poi-merchant"]);
  for (const call of calls) {
    expect(call.filter[0]).toBe("all");
    expect(call.filter[2]).toEqual(["==", ["get", "coinSpecific"], true]);
  }
  await page.getByTitle("cryptoMap.coinOnlyHint").click();
  expect(await page.evaluate(() => (window as any).__maps[0].filterCalls.at(-1).filter)).toEqual(["==", ["get", "layer"], "fintech"]);
  await page.getByTitle("cryptoMap.coinOnlyHint").click();
  expect(await page.evaluate(() => (window as any).__maps[0].filterCalls.at(-1).filter[0])).toBe("all");
});

test("early satellite, 3D and layer clicks apply only after map readiness", async ({ page }) => {
  await mountNavigator(page);
  await page.getByRole("button", { name: "cryptoMap.satellite" }).click();
  await page.getByRole("button", { name: "cryptoMap.threeD" }).click();
  await page.getByRole("button", { name: /cryptoMap\.layer_merchant/ }).click();
  expect(await page.evaluate(() => (window as any).__maps[0].layoutCalls.length)).toBe(0);
  expect(await page.evaluate(() => (window as any).__maps[0].terrainCalls.length)).toBe(0);

  await loadMap(page);
  const state = await page.evaluate(() => {
    const map = (window as any).__maps[0];
    return { layout: map.layoutCalls, terrain: map.terrainCalls, ease: map.easeToCalls };
  });
  expect(state.layout).toEqual(expect.arrayContaining([
    { id: "satellite", name: "visibility", value: "visible" },
    { id: "poi-merchant", name: "visibility", value: "none" },
  ]));
  expect(state.terrain.at(-1)).toEqual({ source: "terrain", exaggeration: 1.3 });
  expect(state.ease.at(-1)).toEqual({ pitch: 60, duration: 800 });
});

test("a late POI response cannot overwrite the newest viewport", async ({ page }) => {
  await mountNavigator(page);
  await loadMap(page);
  await page.waitForFunction(() => (window as any).__requests.filter((r: any) => r.url.includes("/poi?")).length === 1);

  await page.evaluate(() => (window as any).__maps[0].emit("moveend"));
  await page.waitForFunction(() => (window as any).__requests.filter((r: any) => r.url.includes("/poi?")).length === 2);
  await page.evaluate((poi) => {
    const requests = (window as any).__requests.filter((r: any) => r.url.includes("/poi?"));
    requests[1].resolve({ pois: [poi] });
  }, newPoi);
  await page.waitForFunction(() => (window as any).__maps[0].sources.get("pois").data.features[0]?.properties.id === "new");

  await page.evaluate((poi) => {
    const requests = (window as any).__requests.filter((r: any) => r.url.includes("/poi?"));
    requests[0].resolve({ pois: [poi] });
  }, oldPoi);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (window as any).__maps[0].sources.get("pois").data.features[0].properties.id)).toBe("new");
  expect(await page.evaluate(() => (window as any).__requests.filter((r: any) => r.url.includes("/poi?"))[0].signal.aborted)).toBe(true);
});

test("a late directions response cannot overwrite the newest route", async ({ page }) => {
  await mountNavigator(page);
  await loadMap(page);
  await startFirstRoute(page);
  await page.getByRole("button", { name: "🚗 cryptoMap.mode_car" }).click();
  await page.waitForFunction(() => (window as any).__requests.filter((r: any) => r.url.includes("/directions?")).length === 2);

  await page.evaluate((response) => {
    const requests = (window as any).__requests.filter((r: any) => r.url.includes("/directions?"));
    requests[1].resolve(response);
  }, route(2000, "car", 14.6));
  await page.waitForFunction(() => (window as any).__maps[0].sources.get("route").data.features[0]?.geometry.coordinates[1][0] === 14.6);

  await page.evaluate((response) => {
    const requests = (window as any).__requests.filter((r: any) => r.url.includes("/directions?"));
    requests[0].resolve(response);
  }, route(1000, "walk", 14.5));
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (window as any).__maps[0].sources.get("route").data.features[0].geometry.coordinates[1][0])).toBe(14.6);
  expect(await page.evaluate(() => (window as any).__requests.filter((r: any) => r.url.includes("/directions?"))[0].signal.aborted)).toBe(true);
});

test("an aborted directions request does not show a routing error", async ({ page }) => {
  await mountNavigator(page);
  await loadMap(page);
  await startFirstRoute(page);
  await page.getByRole("button", { name: "🚗 cryptoMap.mode_car" }).click();
  await page.waitForFunction(() => (window as any).__requests.filter((r: any) => r.url.includes("/directions?")).length === 2);

  await page.evaluate((response) => {
    const requests = (window as any).__requests.filter((r: any) => r.url.includes("/directions?"));
    requests[0].reject(new DOMException("The operation was aborted", "AbortError"));
    requests[1].resolve(response);
  }, route(2000, "car", 14.6));
  await page.waitForFunction(() => (window as any).__maps[0].sources.get("route").data.features[0]?.geometry.coordinates[1][0] === 14.6);
  await expect(page.locator("body")).not.toContainText("cryptoMap.noRoute");
  await expect(page.locator("body")).not.toContainText("cryptoMap.noTransit");
});

for (const outcome of ["resolve", "reject"] as const) {
  test(`clearOrigin ignores a late directions ${outcome} and cancels pending navigation`, async ({ page }) => {
    await mountNavigator(page);
    await loadMap(page);
    await startFirstRoute(page, true);
    await page.getByRole("button", { name: "cryptoMap.clearOrigin" }).click();
    expect(await page.evaluate(() => (window as any).__requests.find((r: any) => r.url.includes("/directions?")).signal.aborted)).toBe(true);

    await settleDirections(page, 0, outcome);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => (window as any).__maps[0].sources.get("route").data.features)).toEqual([]);
    await expect(page.locator("body")).not.toContainText("cryptoMap.distance");
    await expect(page.locator("body")).not.toContainText("cryptoMap.noRoute");
    expect(await page.evaluate(() => (window as any).__navigationControllers.length)).toBe(0);
  });

  test(`clearRoute ignores a late directions ${outcome}`, async ({ page }) => {
    await mountNavigator(page);
    await loadMap(page);
    await startPendingSecondRoute(page);
    await page.getByRole("button", { name: "cryptoMap.clearRoute" }).click();
    expect(await page.evaluate(() => (window as any).__requests.filter((r: any) => r.url.includes("/directions?"))[1].signal.aborted)).toBe(true);

    await settleDirections(page, 1, outcome);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => (window as any).__maps[0].sources.get("route").data.features)).toEqual([]);
    await expect(page.locator("body")).not.toContainText("cryptoMap.distance");
    await expect(page.locator("body")).not.toContainText("cryptoMap.noRoute");
    await expect(page.locator("body")).not.toContainText("cryptoMap.noTransit");
  });
}

test("changing coinId remounts the navigator and isolates late POI responses", async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => (window as any).__componentTest.renderMapSection("bitcoin"));
  await page.waitForFunction(() => (window as any).__maps.length === 1);
  await loadMap(page);
  await page.waitForFunction(() => (window as any).__requests.some((r: any) => r.url.includes("coin=bitcoin")));

  await page.evaluate(() => (window as any).__componentTest.renderMapSection("ethereum"));
  await page.waitForFunction(() => (window as any).__maps.length === 2);
  expect(await page.evaluate(() => (window as any).__maps[0].removed)).toBe(true);
  expect(await page.evaluate(() => (window as any).__requests.find((r: any) => r.url.includes("coin=bitcoin")).signal.aborted)).toBe(true);
  await loadMap(page, 1);
  await page.waitForFunction(() => (window as any).__requests.some((r: any) => r.url.includes("coin=ethereum")));

  await page.evaluate((poi) => {
    (window as any).__requests.find((r: any) => r.url.includes("coin=ethereum")).resolve({ pois: [poi] });
  }, newPoi);
  await page.waitForFunction(() => (window as any).__maps[1].sources.get("pois").data.features[0]?.properties.id === "new");
  await page.evaluate((poi) => {
    (window as any).__requests.find((r: any) => r.url.includes("coin=bitcoin")).resolve({ pois: [poi] });
  }, oldPoi);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (window as any).__maps[1].sources.get("pois").data.features[0].properties.id)).toBe("new");
});

test("unmount aborts POI and ignores its late response", async ({ page }) => {
  await mountNavigator(page);
  await loadMap(page);
  const source = await page.evaluateHandle(() => (window as any).__maps[0].sources.get("pois"));
  await page.evaluate(() => (window as any).__componentTest.unmount());
  expect(await page.evaluate(() => (window as any).__requests.find((r: any) => r.url.includes("/poi?")).signal.aborted)).toBe(true);

  await page.evaluate((poi) => {
    (window as any).__requests.find((r: any) => r.url.includes("/poi?")).resolve({ pois: [poi] });
  }, oldPoi);
  await page.waitForTimeout(50);
  expect(await source.evaluate((data: any) => data.data.features)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__maps[0].removed)).toBe(true);
});

for (const outcome of ["resolve", "reject"] as const) {
  test(`unmount aborts directions and ignores a late ${outcome}`, async ({ page }) => {
    await mountNavigator(page);
    await loadMap(page);
    await startFirstRoute(page);
    const source = await page.evaluateHandle(() => (window as any).__maps[0].sources.get("route"));
    await page.evaluate(() => (window as any).__componentTest.unmount());
    expect(await page.evaluate(() => (window as any).__requests.find((r: any) => r.url.includes("/directions?")).signal.aborted)).toBe(true);

    await settleDirections(page, 0, outcome);
    await page.waitForTimeout(50);
    expect(await source.evaluate((data: any) => data.data.features)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__maps[0].removed)).toBe(true);
    await expect(page.locator("body")).not.toContainText("cryptoMap.noRoute");
  });
}
