// BTC Map as the crypto-POI source, replacing live Overpass queries.
//
// The public Overpass instances have been saturated for months (HTTP 502
// "all query workers are busy"), which left the navigator silently empty.
// BTC Map (btcmap.org) maintains the same OpenStreetMap data, already filtered
// down to crypto-accepting places, and serves it as one cheap JSON dump — and
// crucially it hands back the untouched `osm_json` element, so every tag we
// already parse (payment:*, contact:*, opening_hours, image…) survives the trip.
//
// We mirror that dump into Postgres nightly and read the viewport from our own
// table, so a slow or down upstream can no longer blank the map at request time.
//
// parseBtcMapElements is pure and unit-tested; fetchBtcMapElements does the IO.

export type OsmPoiRow = {
  id: string; // "node:123" — BTC Map's own id, stable across syncs
  type: string; // node | way | relation
  osmId: string; // numeric OSM id as string (way/relation ids overflow nothing, but keep it textual)
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

type BtcMapOsmJson = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  bounds?: { minlat?: number; minlon?: number; maxlat?: number; maxlon?: number };
  tags?: Record<string, string>;
};

type BtcMapElement = {
  id?: string;
  osm_json?: BtcMapOsmJson;
  // Present-but-empty string means "alive"; a timestamp means the place is gone.
  deleted_at?: string | null;
};

/** Centre of a way/relation: BTC Map gives `bounds` rather than Overpass's `center`. */
function centreOf(j: BtcMapOsmJson): [number, number] | null {
  if (Number.isFinite(j.lat) && Number.isFinite(j.lon)) return [j.lat as number, j.lon as number];
  const b = j.bounds;
  if (!b) return null;
  const { minlat, minlon, maxlat, maxlon } = b;
  if (![minlat, minlon, maxlat, maxlon].every((n) => Number.isFinite(n))) return null;
  return [((minlat as number) + (maxlat as number)) / 2, ((minlon as number) + (maxlon as number)) / 2];
}

/**
 * Flatten a BTC Map dump into rows ready for upsert. Deleted places, elements
 * without usable coordinates and tag-less elements are dropped — the last of
 * those would render as an unnamed dot with nothing in its popup.
 */
export function parseBtcMapElements(raw: unknown): OsmPoiRow[] {
  if (!Array.isArray(raw)) return [];
  const out: OsmPoiRow[] = [];
  for (const el of raw as BtcMapElement[]) {
    if (!el || typeof el !== "object") continue;
    if (typeof el.deleted_at === "string" && el.deleted_at.trim() !== "") continue;
    const j = el.osm_json;
    if (!j) continue;
    const centre = centreOf(j);
    if (!centre) continue;
    const [lat, lon] = centre;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const tags = j.tags;
    if (!tags || typeof tags !== "object" || !Object.keys(tags).length) continue;
    const type = j.type ?? "node";
    const osmId = String(j.id ?? "");
    if (!osmId) continue;
    out.push({ id: el.id ?? `${type}:${osmId}`, type, osmId, lat, lon, tags });
  }
  return out;
}

/** Ids BTC Map marks as deleted — removed from our mirror so they stop rendering. */
export function parseBtcMapDeletedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const el of raw as BtcMapElement[]) {
    if (!el || typeof el !== "object" || !el.id) continue;
    if (typeof el.deleted_at === "string" && el.deleted_at.trim() !== "") out.push(el.id);
  }
  return out;
}

const BTCMAP_URL = "https://api.btcmap.org/v2/elements";
const UA = "trientes.org crypto-navigator (https://trientes.org)";

/**
 * The full dump is ~40 MB / ~43k elements and answers in a couple of seconds.
 * Pass `updatedSince` (ISO) for an incremental pull — the same endpoint then
 * returns only what changed, including freshly-deleted places.
 */
export async function fetchBtcMapElements(updatedSince?: string, timeoutMs = 120_000): Promise<unknown> {
  const url = updatedSince
    ? `${BTCMAP_URL}?updated_since=${encodeURIComponent(updatedSince)}`
    : BTCMAP_URL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`btcmap HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
