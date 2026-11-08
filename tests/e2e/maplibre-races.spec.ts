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
    this.sources = new globalThis.Map();
    this.layers = new globalThis.Map();
    this.filterCalls = [];
    this.layoutCalls = [];
    this.removed = false;
    this.styleLoaded = false;
    globalThis.__maps.push(this);
  }
  addControl() { return this; }
  addSource(id, specification) { this.sources.set(id, new Source(specification)); }
  getSource(id) { return this.sources.get(id); }
  addLayer(layer) { this.layers.set(layer.id, layer); }
  getLayer(id) { return this.layers.get(id); }
  setFilter(id, filter) { this.filterCalls.push({ id, filter }); }
  setLayoutProperty(id, name, value) { this.layoutCalls.push({ id, name, value }); }
  getZoom() { return 13; }
  getBounds() {
    return { getWest: () => 14, getSouth: () => 50, getEast: () => 15, getNorth: () => 51 };
  }
  getCenter() { return { lng: 14.42, lat: 50.08 }; }
  getCanvas() { return { style: {} }; }
  queryRenderedFeatures() { return []; }
  fitBounds() {}
  flyTo() {}
  easeTo() {}
  setTerrain() {}
  isStyleLoaded() { return this.styleLoaded; }
  loaded() { return this.styleLoaded; }
  remove() { this.removed = true; }
}

export class GeolocateControl extends EventTarget {
  constructor(options) { super(); this.options = options; globalThis.__geolocates.push(this); }
}
export class NavigationControl { constructor(options) { this.options = options; } }
export class Marker {
  constructor(options = {}) { this.options = options; }
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

globalThis.__maps = [];
globalThis.__geolocates = [];
globalThis.__popups = [];
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
    ["@/app/actions/company", `
      export async function submitCompanyPoint() { return {}; }
      export async function updateCompanyPoint() { return {}; }
    `],
    ["@/components/coin-detail/street-view-overlay", `export function StreetViewOverlay() { return null; }`],
    ["@/components/fintech/available-fintech-panel", `export function AvailableFintechPanel() { return null; }`],
    ["./navigation-controller", `
      export class NavigationController {
        updateRoute() {}
        stop() {}
        async start() {}
      }
    `],
  ]);
  const plugin: Plugin = {
    name: "component-test-mocks",
    setup(build) {
      build.onResolve({ filter: /^maplibre-gl$/ }, () => ({ path: "maplibre-gl", namespace: "virtual" }));
      build.onResolve({ filter: /^next-intl$/ }, () => ({ path: "next-intl", namespace: "virtual" }));
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next/navigation", namespace: "virtual" }));
      build.onResolve({ filter: /^@\/app\/actions\/company$/ }, () => ({ path: "@/app/actions/company", namespace: "virtual" }));
      build.onResolve({ filter: /^@\/components\/coin-detail\/street-view-overlay$/ }, () => ({ path: "@/components/coin-detail/street-view-overlay", namespace: "virtual" }));
      build.onResolve({ filter: /^@\/components\/fintech\/available-fintech-panel$/ }, () => ({ path: "@/components/fintech/available-fintech-panel", namespace: "virtual" }));
      build.onResolve({ filter: /^\.\/navigation-controller$/ }, () => ({ path: "./navigation-controller", namespace: "virtual" }));
      build.onResolve({ filter: /\.css$/ }, () => ({ path: "style", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => ({ contents: virtual.get(args.path), loader: "js" }));
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

async function mountNavigator(page: Page) {
  await page.goto("about:blank");
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
  await page.evaluate(() => (window as any).__componentTest.mountNavigator());
  await page.waitForFunction(() => (window as any).__maps.length === 1);
}

async function loadMap(page: Page) {
  await page.evaluate(() => (window as any).__maps[0].emit("load"));
  await page.waitForFunction(() => (window as any).__maps[0].sources.has("pois"));
}

async function startFirstRoute(page: Page) {
  await page.evaluate(() => {
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
    popup.content.querySelector(".cmap-route").click();
  });
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

test("coinOnly waits for style load and applies the latest filter to all POI layers", async ({ page }) => {
  await mountNavigator(page);
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
