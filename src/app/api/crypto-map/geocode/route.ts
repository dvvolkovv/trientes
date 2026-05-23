import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchGeocode, fetchReverseGeocode } from "@/lib/crypto-map";

export const dynamic = "force-dynamic";

const TTL = 86400; // 1d — addresses don't move.

// Reverse branch: ?lat=&lon= resolves a dropped pin to an address.
async function reverse(latRaw: string, lonRaw: string) {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ result: null }, { status: 400 });
  }
  const cacheKey = `cmap:rgeo:${lat.toFixed(4)},${lon.toFixed(4)}`;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json({ result: JSON.parse(cached) }, { headers: { "x-cache": "hit" } });
  } catch {
    // ignore
  }
  try {
    const result = await fetchReverseGeocode(lon, lat);
    try {
      await redis.set(cacheKey, JSON.stringify(result), "EX", TTL);
    } catch {
      // best-effort
    }
    return NextResponse.json({ result }, { headers: { "x-cache": "miss" } });
  } catch {
    return NextResponse.json({ result: null }, { headers: { "x-cache": "error" } });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (lat !== null && lon !== null) return reverse(lat, lon);

  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const cacheKey = `cmap:geo:${q.toLowerCase()}`;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json({ results: JSON.parse(cached) }, { headers: { "x-cache": "hit" } });
  } catch {
    // ignore
  }

  try {
    const results = await fetchGeocode(q);
    try {
      await redis.set(cacheKey, JSON.stringify(results), "EX", TTL);
    } catch {
      // best-effort
    }
    return NextResponse.json({ results }, { headers: { "x-cache": "miss" } });
  } catch {
    return NextResponse.json({ results: [] }, { headers: { "x-cache": "error" } });
  }
}
