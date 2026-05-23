// Street-level imagery near a point, for the navigator's "Окрестности" preview.
// Two key-optional sources normalized to one shape: Panoramax (key-less, STAC) and
// Mapillary (best coverage, needs MAPILLARY_TOKEN server-side). Pure parse/sort helpers
// are unit-tested; fetch* do the network IO and degrade to [] on failure.

export type StreetShot = {
  id: string;
  lat: number;
  lon: number;
  thumb: string; // ready-to-display image URL
  capturedAt: number | null; // epoch ms
  bearing: number | null; // compass angle, degrees
  source: "mapillary" | "panoramax";
};

export type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

/** Square-ish bbox of ±`meters` around a point (longitude widened by the cos factor). */
export function bboxAround(lat: number, lon: number, meters: number): Bbox {
  const latDeg = meters / 111320;
  const lonDeg = meters / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
  return { minLon: lon - lonDeg, minLat: lat - latDeg, maxLon: lon + lonDeg, maxLat: lat + latDeg };
}

/** Great-circle distance in metres. */
export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type MlyImage = {
  id?: string | number;
  geometry?: { coordinates?: [number, number] };
  computed_geometry?: { coordinates?: [number, number] };
  captured_at?: number;
  compass_angle?: number;
  thumb_1024_url?: string;
  thumb_2048_url?: string;
};

export function parseMapillaryImages(raw: unknown): StreetShot[] {
  const data = (raw as { data?: MlyImage[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: StreetShot[] = [];
  for (const im of data) {
    const coords = im.geometry?.coordinates ?? im.computed_geometry?.coordinates;
    const thumb = im.thumb_1024_url || im.thumb_2048_url;
    if (!coords || !thumb) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id: String(im.id ?? `${lon},${lat}`),
      lat,
      lon,
      thumb,
      capturedAt: Number.isFinite(im.captured_at) ? (im.captured_at as number) : null,
      bearing: Number.isFinite(im.compass_angle) ? (im.compass_angle as number) : null,
      source: "mapillary",
    });
  }
  return out;
}

type StacFeature = {
  id?: string | number;
  geometry?: { coordinates?: [number, number] };
  properties?: { datetime?: string; "view:azimuth"?: number };
  assets?: Record<string, { href?: string }>;
};

export function parsePanoramax(raw: unknown): StreetShot[] {
  const features = (raw as { features?: StacFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: StreetShot[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    const thumb = f.assets?.sd?.href || f.assets?.thumb?.href || f.assets?.hd?.href;
    if (!coords || !thumb) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const dt = f.properties?.datetime ? Date.parse(f.properties.datetime) : NaN;
    const az = f.properties?.["view:azimuth"];
    out.push({
      id: String(f.id ?? `${lon},${lat}`),
      lat,
      lon,
      thumb,
      capturedAt: Number.isFinite(dt) ? dt : null,
      bearing: Number.isFinite(az) ? (az as number) : null,
      source: "panoramax",
    });
  }
  return out;
}

export type RankedShot = StreetShot & { distanceM: number };

/** Nearest-first, annotated with distance to the target. */
export function sortByDistance(shots: StreetShot[], lat: number, lon: number): RankedShot[] {
  return shots
    .map((s) => ({ ...s, distanceM: haversineMeters(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Thin a distance-sorted list to ~one frame per `minGapM`, so a dense burst of
 *  near-identical frames becomes a few distinct viewpoints along the approach. */
export function spaceByDistance(ranked: RankedShot[], minGapM: number): RankedShot[] {
  const out: RankedShot[] = [];
  let lastKept = -Infinity;
  for (const s of ranked) {
    if (out.length === 0 || s.distanceM >= lastKept + minGapM) {
      out.push(s);
      lastKept = s.distanceM;
    }
  }
  return out;
}

// ---- Network (wrapped; callers degrade to [] ) ----

const UA = "trientes.org crypto-navigator (https://trientes.org)";
const RADIUS_M = 180; // a little past "150 m before" so shots lead up to the point
const NEAREST = 15;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPanoramax(lat: number, lon: number, timeoutMs = 8000): Promise<StreetShot[]> {
  const b = bboxAround(lat, lon, RADIUS_M);
  const url = `https://api.panoramax.xyz/api/search?bbox=${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}&limit=80`;
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, cache: "no-store", signal });
    if (!res.ok) throw new Error(`panoramax HTTP ${res.status}`);
    return parsePanoramax(await res.json());
  });
}

export async function fetchMapillary(lat: number, lon: number, token: string, timeoutMs = 8000): Promise<StreetShot[]> {
  const b = bboxAround(lat, lon, RADIUS_M);
  const fields = "id,geometry,computed_geometry,captured_at,compass_angle,thumb_1024_url";
  const url =
    `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}` +
    `&fields=${fields}&bbox=${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}&limit=100`;
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal });
    if (!res.ok) throw new Error(`mapillary HTTP ${res.status}`);
    return parseMapillaryImages(await res.json());
  });
}

/** Pick a source (Mapillary if a token is set, else/также Panoramax), return nearest shots. */
export async function fetchStreetShots(
  lat: number,
  lon: number,
): Promise<{ shots: RankedShot[]; source: StreetShot["source"] | null }> {
  const token = process.env.MAPILLARY_TOKEN;
  let shots: StreetShot[] = [];
  let source: StreetShot["source"] | null = null;

  if (token) {
    try {
      shots = await fetchMapillary(lat, lon, token);
      if (shots.length) source = "mapillary";
    } catch {
      shots = [];
    }
  }
  if (!shots.length) {
    try {
      shots = await fetchPanoramax(lat, lon);
      if (shots.length) source = "panoramax";
    } catch {
      shots = [];
    }
  }
  const spaced = spaceByDistance(sortByDistance(shots, lat, lon), 8).slice(0, NEAREST);
  return { shots: spaced, source };
}
