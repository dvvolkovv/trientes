import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchStreetShots } from "@/lib/streetview";

export const dynamic = "force-dynamic";

const TTL = 604800; // 7d — street imagery near a point changes slowly; empty cached too.

// ~55 m buckets so nearby destinations share a cache entry.
function round(n: number): string {
  return (Math.round(n / 0.0005) * 0.0005).toFixed(4);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ shots: [], source: null }, { status: 400 });
  }

  const key = `cmap:sv:${round(lat)},${round(lon)}`;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(key);
    if (cached) return NextResponse.json(JSON.parse(cached), { headers: { "x-cache": "hit" } });
  } catch {
    // ignore — fall through to fetch
  }

  let result: Awaited<ReturnType<typeof fetchStreetShots>> = { shots: [], source: null };
  try {
    result = await fetchStreetShots(lat, lon); // each source is already try/caught inside
  } catch {
    // source down — degrade to empty
  }
  try {
    await redis.set(key, JSON.stringify(result), "EX", TTL);
  } catch {
    // best-effort cache write
  }
  return NextResponse.json(result, { headers: { "x-cache": "miss" } });
}
