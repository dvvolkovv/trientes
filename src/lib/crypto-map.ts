// Crypto Navigator data layer — places that transact in crypto, around the viewer.
//
// All sources are free and key-less: Overpass (OpenStreetMap) for the points,
// Nominatim for address geocoding, OSRM's public demo for routing. Pure parsing
// (parseOverpassElements / parseNominatim / parseOsrm / parseBbox / coinPaymentTags)
// is unit-tested; the fetch* helpers do the network IO and are wrapped so callers
// can degrade to empty results. Mirrors the fear-greed lib's parse/fetch split.

export type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

/** Parse "minLon,minLat,maxLon,maxLat" (GeoJSON / MapLibre bounds order). */
export function parseBbox(s: string | null): Bbox | null {
  if (!s) return null;
  const parts = s.split(",").map((x) => Number(x.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
  if (maxLon <= minLon || maxLat <= minLat) return null;
  return { minLon, minLat, maxLon, maxLat };
}

// OSM payment/currency tags that mark "this coin is accepted here". Bitcoin is by
// far the best-tagged; known altcoins get their specific tag; everything else
// falls back to the generic crypto tag (so the map is still coin-aware where data exists).
const COIN_TAGS: Record<string, string[]> = {
  bitcoin: ["payment:bitcoin", "currency:XBT", "payment:lightning", "payment:lightning_contactless"],
  ethereum: ["payment:ethereum"],
  litecoin: ["payment:litecoin"],
  dogecoin: ["payment:dogecoin"],
  monero: ["payment:monero", "currency:XMR"],
  dash: ["payment:dash"],
  "bitcoin-cash": ["payment:bitcoincash", "currency:BCH"],
  nano: ["payment:nano"],
  zcash: ["payment:zcash"],
};

const SYMBOL_TO_ID: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  ltc: "litecoin",
  doge: "dogecoin",
  xmr: "monero",
  dash: "dash",
  bch: "bitcoin-cash",
  xno: "nano",
  zec: "zcash",
};

export function coinPaymentTags(coinId: string, symbol: string): string[] {
  const byId = COIN_TAGS[coinId.toLowerCase()];
  if (byId) return byId;
  const id = SYMBOL_TO_ID[symbol.toLowerCase()];
  if (id && COIN_TAGS[id]) return COIN_TAGS[id];
  return ["payment:cryptocurrencies"];
}

// The tag set that pulls every crypto-accepting place into the query, regardless of coin.
const QUERY_TAGS = [
  "payment:bitcoin",
  "currency:XBT",
  "payment:lightning",
  "payment:lightning_contactless",
  "payment:cryptocurrencies",
];

export function buildOverpassQuery(b: Bbox): string {
  // Overpass bbox order: (south,west,north,east) = (minLat,minLon,maxLat,maxLon).
  const box = `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
  const union = QUERY_TAGS.map((t) => `nwr["${t}"="yes"](${box});`).join("");
  return `[out:json][timeout:25];(${union});out center tags 400;`;
}

export type PoiLayer = "merchant" | "atm" | "financial";

export type Poi = {
  id: string; // "node/123"
  lat: number;
  lon: number;
  name: string;
  layer: PoiLayer;
  category: string;
  address: string | null;
  lightning: boolean;
  coinSpecific: boolean;
  website: string | null;
};

type OsmElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function prettify(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function classify(tags: Record<string, string>): { layer: PoiLayer; category: string } {
  const amenity = tags.amenity;
  if (
    amenity === "atm" ||
    amenity === "bureau_de_change" ||
    amenity === "vending_machine" ||
    tags.vending === "cryptocurrency"
  ) {
    return { layer: "atm", category: tags.vending === "cryptocurrency" ? "Crypto ATM" : prettify(amenity ?? "ATM") };
  }
  if (amenity === "bank" || tags.office === "financial" || tags.office === "bank") {
    return { layer: "financial", category: prettify(amenity ?? tags.office ?? "Financial") };
  }
  const kind = tags.shop ?? tags.amenity ?? tags.tourism ?? tags.office ?? tags.craft ?? tags.leisure;
  return { layer: "merchant", category: kind ? prettify(kind) : "Merchant" };
}

function buildAddress(tags: Record<string, string>): string | null {
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const parts = [street, tags["addr:city"]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function parseOverpassElements(raw: unknown, coinTags: string[]): Poi[] {
  const elements = (raw as { elements?: OsmElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: Poi[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = el.tags ?? {};
    const { layer, category } = classify(tags);
    const name = tags.name || tags.operator || tags.brand || (layer === "atm" ? "Crypto ATM" : prettify(category));
    const lightning =
      tags["payment:lightning"] === "yes" || tags["payment:lightning_contactless"] === "yes";
    const coinSpecific = coinTags.some((t) => tags[t] === "yes");
    out.push({
      id: `${el.type ?? "node"}/${el.id ?? 0}`,
      lat: lat as number,
      lon: lon as number,
      name,
      layer,
      category,
      address: buildAddress(tags),
      lightning,
      coinSpecific,
      website: tags.website || tags.url || null,
    });
  }
  return out;
}

export type GeoResult = { label: string; lat: number; lon: number };

export function parseNominatim(raw: unknown): GeoResult[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoResult[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const label = String(r.display_name ?? "").trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label) continue;
    out.push({ label, lat, lon });
  }
  return out;
}

export type RouteResult = {
  distance: number; // meters
  duration: number; // seconds
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

export function parseOsrm(raw: unknown): RouteResult | null {
  const r = raw as { code?: string; routes?: Array<Record<string, unknown>> } | null;
  if (!r || r.code !== "Ok" || !Array.isArray(r.routes) || r.routes.length === 0) return null;
  const route = r.routes[0];
  const distance = Number(route.distance);
  const duration = Number(route.duration);
  const geometry = route.geometry as RouteResult["geometry"] | undefined;
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || !geometry?.coordinates) return null;
  return { distance, duration, geometry };
}

// ---- Network helpers (wrapped; callers degrade to empty/null on failure) ----

const UA = "trientes.org crypto-navigator (https://trientes.org)";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPois(bbox: Bbox, coinTags: string[], timeoutMs = 25000): Promise<Poi[]> {
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: "data=" + encodeURIComponent(buildOverpassQuery(bbox)),
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
    return parseOverpassElements(await res.json(), coinTags);
  });
}

export async function fetchGeocode(q: string, timeoutMs = 8000): Promise<GeoResult[]> {
  return withTimeout(timeoutMs, async (signal) => {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`);
    return parseNominatim(await res.json());
  });
}

export async function fetchRoute(
  from: [number, number],
  to: [number, number],
  timeoutMs = 8000,
): Promise<RouteResult | null> {
  return withTimeout(timeoutMs, async (signal) => {
    const url = `${OSRM_URL}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal });
    if (!res.ok) throw new Error(`osrm HTTP ${res.status}`);
    return parseOsrm(await res.json());
  });
}
