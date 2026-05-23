// Crypto Navigator data layer — places that transact in crypto, around the viewer.
//
// All sources are free and key-less: Overpass (OpenStreetMap) for the points,
// Nominatim for address geocoding, OSRM's public demo for routing. Pure parsing
// (parseOverpassElements / parseNominatim / parseOsrm / parseBbox / coinPaymentTags)
// is unit-tested; the fetch* helpers do the network IO and are wrapped so callers
// can degrade to empty results. Mirrors the fear-greed lib's parse/fetch split.

import { lookup } from "node:dns/promises";

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

export type Social = { network: string; url: string };

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
  openingHours: string | null;
  phone: string | null;
  email: string | null;
  socials: Social[];
  image: string | null;
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

// Social networks we surface, with the base used to expand a bare handle into a URL.
const SOCIAL_BASES: Record<string, string> = {
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
  telegram: "https://t.me/",
  twitter: "https://x.com/",
  x: "https://x.com/",
  youtube: "https://youtube.com/",
  tiktok: "https://tiktok.com/@",
  vk: "https://vk.com/",
  linkedin: "https://linkedin.com/",
};

const isHttp = (s: string) => /^https?:\/\//i.test(s);

/** Map OSM `contact:*` (and bare) tags to {network, url}; bare handles get a base prepended. */
export function parseSocials(tags: Record<string, string>): Social[] {
  const out: Social[] = [];
  for (const network of Object.keys(SOCIAL_BASES)) {
    const raw = (tags[`contact:${network}`] ?? tags[network] ?? "").trim();
    if (!raw) continue;
    const url = isHttp(raw) ? raw : SOCIAL_BASES[network] + raw.replace(/^@/, "");
    out.push({ network, url });
  }
  const wa = (tags["contact:whatsapp"] ?? tags.whatsapp ?? "").trim();
  if (wa) {
    if (isHttp(wa)) out.push({ network: "whatsapp", url: wa });
    else {
      const digits = wa.replace(/\D/g, "");
      if (digits) out.push({ network: "whatsapp", url: "https://wa.me/" + digits });
    }
  }
  return out;
}

/** A displayable photo URL from OSM: a direct `image`, else a Wikimedia Commons thumb. */
export function parseOsmImage(tags: Record<string, string>): string | null {
  const img = (tags.image ?? "").trim();
  if (isHttp(img)) return img;
  const wc = (tags.wikimedia_commons ?? "").trim();
  if (wc.startsWith("File:")) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wc.slice(5))}?width=400`;
  }
  return null;
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
      website: tags.website || tags["contact:website"] || tags.url || null,
      openingHours: tags.opening_hours || null,
      phone: tags["contact:phone"] || tags.phone || null,
      email: tags["contact:email"] || tags.email || null,
      socials: parseSocials(tags),
      image: parseOsmImage(tags),
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

// Nominatim `reverse` returns a single object (not an array like `search`), or
// `{ error: ... }` when the point can't be resolved.
export function parseReverseGeocode(raw: unknown): GeoResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.error) return null;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  const label = String(r.display_name ?? "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label) return null;
  return { label, lat, lon };
}

export type RouteMode = "walk" | "car" | "transit";

export type OsrmRoute = {
  distance: number; // meters
  duration: number; // seconds
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

// A single leg of a public-transport itinerary — a walking connector or a vehicle ride.
export type TransitLeg = {
  mode: string; // "WALK" | "SUBWAY" | "BUS" | "TRAM" | "RAIL" | …
  line: string | null; // route short name, e.g. "U4"
  from: string | null; // boarding stop
  to: string | null; // alighting stop
  duration: number; // seconds
  dashed: boolean; // render dashed (walking connector)
  color: string; // line colour on the map
  coordinates: [number, number][]; // [lon,lat]
};

export type RouteResult = OsrmRoute & {
  mode: RouteMode;
  transfers?: number; // transit only
  legs?: TransitLeg[]; // transit only
};

export function parseOsrm(raw: unknown): OsrmRoute | null {
  const r = raw as { code?: string; routes?: Array<Record<string, unknown>> } | null;
  if (!r || r.code !== "Ok" || !Array.isArray(r.routes) || r.routes.length === 0) return null;
  const route = r.routes[0];
  const distance = Number(route.distance);
  const duration = Number(route.duration);
  const geometry = route.geometry as OsrmRoute["geometry"] | undefined;
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || !geometry?.coordinates) return null;
  return { distance, duration, geometry };
}

// ---- Public-transport routing (MOTIS / Transitous) ----

// Google "encoded polyline" → [lon,lat] pairs (GeoJSON order). MOTIS emits precision 7.
export function decodePolyline(str: string, precision = 5): [number, number][] {
  const factor = Math.pow(10, precision);
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

// Map a MOTIS leg mode to a line colour: rail/metro blue, bus green, tram orange.
const TRANSIT_COLORS: Record<string, string> = {
  WALK: "#8a8f98",
  SUBWAY: "#5B8DEF",
  METRO: "#5B8DEF",
  RAIL: "#5B8DEF",
  REGIONAL_RAIL: "#5B8DEF",
  REGIONAL_FAST_RAIL: "#5B8DEF",
  LONG_DISTANCE: "#5B8DEF",
  HIGHSPEED_RAIL: "#5B8DEF",
  NIGHT_RAIL: "#5B8DEF",
  BUS: "#30B658",
  COACH: "#30B658",
  TRAM: "#FE5C04",
  FERRY: "#19C2C2",
};

function transitColor(mode: string): string {
  return TRANSIT_COLORS[mode.toUpperCase()] ?? "#FE5C04";
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

function legLengthMeters(c: [number, number][]): number {
  const R = 6371000;
  let total = 0;
  for (let i = 1; i < c.length; i++) {
    const dLat = ((c[i][1] - c[i - 1][1]) * Math.PI) / 180;
    const dLon = ((c[i][0] - c[i - 1][0]) * Math.PI) / 180;
    const la1 = (c[i - 1][1] * Math.PI) / 180;
    const la2 = (c[i][1] * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return total;
}

type MotisLeg = {
  mode?: string;
  duration?: number;
  routeShortName?: string;
  from?: { name?: string };
  to?: { name?: string };
  legGeometry?: { points?: string; precision?: number };
};
type MotisItinerary = { duration?: number; transfers?: number; legs?: MotisLeg[] };

/** Take the first MOTIS itinerary; decode + stitch its legs into one route. */
export function parseMotis(raw: unknown): RouteResult | null {
  const its = (raw as { itineraries?: MotisItinerary[] } | null)?.itineraries;
  if (!Array.isArray(its) || its.length === 0) return null;
  const it = its[0];
  const rawLegs = Array.isArray(it.legs) ? it.legs : [];
  const legs: TransitLeg[] = [];
  const coords: [number, number][] = [];
  let distance = 0;
  for (const lg of rawLegs) {
    const mode = String(lg.mode ?? "WALK").toUpperCase();
    const pts = lg.legGeometry?.points;
    const c = typeof pts === "string" && pts ? decodePolyline(pts, lg.legGeometry?.precision ?? 7) : [];
    if (c.length === 0) continue;
    for (let i = 0; i < c.length; i++) {
      if (i === 0 && coords.length && samePoint(coords[coords.length - 1], c[0])) continue;
      coords.push(c[i]);
    }
    distance += legLengthMeters(c);
    legs.push({
      mode,
      line: lg.routeShortName ? String(lg.routeShortName) : null,
      from: lg.from?.name ?? null,
      to: lg.to?.name ?? null,
      duration: Number(lg.duration) || 0,
      dashed: mode === "WALK",
      color: transitColor(mode),
      coordinates: c,
    });
  }
  if (coords.length < 2 || legs.length === 0) return null;
  const duration = Number(it.duration);
  const transfers = Number(it.transfers);
  return {
    mode: "transit",
    distance: Math.round(distance),
    duration: Number.isFinite(duration) ? duration : legs.reduce((s, l) => s + l.duration, 0),
    geometry: { type: "LineString", coordinates: coords },
    transfers: Number.isFinite(transfers) ? transfers : 0,
    legs,
  };
}

// ---- OpenGraph preview (lazy, per-POI website) ----

export type OgPreview = { title: string | null; image: string | null; video: string | null };

// Decode the handful of HTML entities that actually show up in meta content —
// crucially `&amp;`, which CDNs emit inside og:image query strings. `&amp;` is
// resolved last so `&amp;amp;` collapses to `&amp;` rather than `&`.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Read one attribute off a single `<meta …>` string. The name must be preceded by
// whitespace (or tag start) so `content` doesn't match inside `data-content`.
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities((m[2] ?? m[3] ?? "").trim()) : null;
}

function metaContent(html: string, keys: string[]): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    if (key && keys.includes(key)) {
      const content = attr(m[0], "content");
      if (content) return content;
    }
  }
  return null;
}

function absHttp(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Extract og:image/og:video/og:title (twitter:image fallback); resolve & http(s)-filter URLs. */
export function parseOpenGraph(html: string, baseUrl: string): OgPreview {
  return {
    title: metaContent(html, ["og:title"]) ?? null,
    image: absHttp(metaContent(html, ["og:image", "og:image:url", "og:image:secure_url", "twitter:image"]), baseUrl),
    video: absHttp(metaContent(html, ["og:video", "og:video:url", "og:video:secure_url"]), baseUrl),
  };
}

// ---- SSRF guard ----

/** True for loopback / private / link-local / unspecified IPv4 & IPv6 (incl. IPv4-mapped). */
export function isBlockedIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  const m4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const a = Number(m4[1]);
    const b = Number(m4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (v === "::" || v === "::1") return true;
  if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(v)) return true; // unique-local fc00::/7
  const mapped = v.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIp(mapped[1]);
  return false;
}

/** Return the URL unchanged iff it parses as absolute http(s); else null. Blocks
 * `javascript:`/`data:` and relative junk before rendering an untrusted link/href. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/** Validate scheme/credentials and reject literal-IP/localhost hosts. Does NOT resolve DNS. */
export function assertUrlShape(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme not allowed");
  if (u.username || u.password) throw new Error("credentials not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("localhost not allowed");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    if (isBlockedIp(host)) throw new Error("blocked ip literal");
  }
  return u;
}

// ---- Network helpers (wrapped; callers degrade to empty/null on failure) ----

const UA = "trientes.org crypto-navigator (https://trientes.org)";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
// FOSSGIS OSRM instances are key-less and expose the foot profile (the demo server
// only has driving); MOTIS/Transitous adds key-less timetable-based transit routing.
const OSRM_FOOT_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
const OSRM_CAR_URL = "https://routing.openstreetmap.de/routed-car/route/v1/driving";
const MOTIS_URL = "https://api.transitous.org/api/v1/plan";

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

// Resolve a dropped/dragged pin (lon,lat) to a human address, best-effort.
export async function fetchReverseGeocode(
  lon: number,
  lat: number,
  timeoutMs = 8000,
): Promise<GeoResult | null> {
  return withTimeout(timeoutMs, async (signal) => {
    const url = `${NOMINATIM_REVERSE_URL}?format=jsonv2&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`nominatim reverse HTTP ${res.status}`);
    return parseReverseGeocode(await res.json());
  });
}

export async function fetchRoute(
  from: [number, number],
  to: [number, number],
  mode: RouteMode = "car",
  timeoutMs = 9000,
): Promise<RouteResult | null> {
  return withTimeout(timeoutMs, async (signal) => {
    if (mode === "transit") {
      // MOTIS takes lat,lon (OSRM/our tuples are lon,lat).
      const url =
        `${MOTIS_URL}?fromPlace=${from[1]},${from[0]}&toPlace=${to[1]},${to[0]}` +
        `&transitModes=TRANSIT&directModes=WALK`;
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": UA },
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error(`motis HTTP ${res.status}`);
      return parseMotis(await res.json());
    }
    const base = mode === "walk" ? OSRM_FOOT_URL : OSRM_CAR_URL;
    const url = `${base}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`osrm HTTP ${res.status}`);
    const r = parseOsrm(await res.json());
    return r ? { ...r, mode } : null;
  });
}

// ---- OpenGraph fetch (SSRF-guarded; degrades to an empty preview) ----

const EMPTY_OG: OgPreview = { title: null, image: null, video: null };
const OG_MAX_BYTES = 256 * 1024;

// `dns.lookup` ignores AbortSignal, so the outer fetch timeout can't bound it —
// race it against its own timeout to avoid a hung resolver stalling the request.
async function lookupAll(host: string, ms = 4000): Promise<Array<{ address: string }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("dns timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** assertUrlShape + DNS resolution, rejecting hosts that resolve to a blocked IP. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = assertUrlShape(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return u; // already vetted as a literal
  const records = await lookupAll(host);
  if (records.some((r) => isBlockedIp(r.address))) throw new Error("resolves to blocked ip");
  return u;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks));
}

/** Fetch a place's website and return its OpenGraph preview. Best-effort; never throws. */
export async function fetchOgPreview(rawUrl: string, timeoutMs = 6000): Promise<OgPreview> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      let current = await assertPublicUrl(rawUrl);
      let res: Response | null = null;
      for (let hop = 0; hop < 3; hop++) {
        res = await fetch(current.href, {
          headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
          redirect: "manual",
          cache: "no-store",
          signal,
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) break;
          current = await assertPublicUrl(new URL(loc, current).href); // re-vet every hop
          continue;
        }
        break;
      }
      if (!res || !res.ok) return EMPTY_OG;
      if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("html")) return EMPTY_OG;
      return parseOpenGraph(await readCapped(res, OG_MAX_BYTES), current.href);
    });
  } catch {
    return EMPTY_OG;
  }
}
