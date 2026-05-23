import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchRoute, type RouteMode } from "@/lib/crypto-map";

export const dynamic = "force-dynamic";

// Walk/car geometry is stable; transit depends on the timetable/time-of-day, so cache it briefly.
const TTL: Record<RouteMode, number> = { walk: 3600, car: 3600, transit: 900 };

function parseMode(s: string | null): RouteMode {
  return s === "walk" || s === "transit" ? s : "car";
}

// Parse "lon,lat" into a tuple, validating ranges.
function parseLonLat(s: string | null): [number, number] | null {
  if (!s) return null;
  const [lon, lat] = s.split(",").map((n) => Number(n.trim()));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = parseLonLat(url.searchParams.get("from"));
  const to = parseLonLat(url.searchParams.get("to"));
  const mode = parseMode(url.searchParams.get("mode"));
  if (!from || !to) return NextResponse.json({ error: "invalid from/to" }, { status: 400 });

  const key = (p: [number, number]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const cacheKey = `cmap:route:${mode}:${key(from)}:${key(to)}`;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json(JSON.parse(cached), { headers: { "x-cache": "hit" } });
  } catch {
    // ignore
  }

  try {
    const route = await fetchRoute(from, to, mode);
    if (!route) return NextResponse.json({ error: "no route" }, { status: 404 });
    try {
      await redis.set(cacheKey, JSON.stringify(route), "EX", TTL[mode]);
    } catch {
      // best-effort
    }
    return NextResponse.json(route, { headers: { "x-cache": "miss" } });
  } catch {
    return NextResponse.json({ error: "routing unavailable" }, { status: 502 });
  }
}
