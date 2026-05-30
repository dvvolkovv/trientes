import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchGeocode, fetchReverseGeocode } from "@/lib/crypto-map";
import { searchApprovedPointsByName } from "@/lib/company-points";

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

  // Two-source search: registered company points (by name / brand, looked up
  // fresh so new approvals appear instantly) + Nominatim addresses (cached).
  // Places rank first so typing a brand name finds the business, not a street.
  const cacheKey = `cmap:geo:${q.toLowerCase()}`;
  let addressResults: { label: string; lat: number; lon: number }[] = [];
  let addressCache: "hit" | "miss" | "error" = "miss";
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) {
      addressResults = JSON.parse(cached);
      addressCache = "hit";
    }
  } catch {
    // ignore
  }
  if (addressCache !== "hit") {
    try {
      addressResults = await fetchGeocode(q);
      try {
        await redis.set(cacheKey, JSON.stringify(addressResults), "EX", TTL);
      } catch {
        // best-effort
      }
    } catch {
      addressCache = "error";
    }
  }

  let places: { label: string; lat: number; lon: number }[] = [];
  try {
    places = await searchApprovedPointsByName(q, 5);
  } catch {
    // DB hiccup — fall back to address results only.
  }

  return NextResponse.json(
    { results: [...places, ...addressResults] },
    { headers: { "x-cache": addressCache } },
  );
}
