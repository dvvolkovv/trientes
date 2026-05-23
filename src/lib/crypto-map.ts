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

// ---- OpenGraph preview (lazy, per-POI website) ----

export type OgPreview = { title: string | null; image: string | null; video: string | null };

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? "").trim() : null;
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

// ---- OpenGraph fetch (SSRF-guarded; degrades to an empty preview) ----

const EMPTY_OG: OgPreview = { title: null, image: null, video: null };
const OG_MAX_BYTES = 256 * 1024;

/** assertUrlShape + DNS resolution, rejecting hosts that resolve to a blocked IP. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = assertUrlShape(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return u; // already vetted as a literal
  const records = await lookup(host, { all: true });
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
      if (!(res.headers.get("content-type") ?? "").includes("html")) return EMPTY_OG;
      return parseOpenGraph(await readCapped(res, OG_MAX_BYTES), current.href);
    });
  } catch {
    return EMPTY_OG;
  }
}
