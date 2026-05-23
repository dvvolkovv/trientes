import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchGeocode } from "@/lib/crypto-map";

export const dynamic = "force-dynamic";

const TTL = 86400; // 1d — addresses don't move.

export async function GET(req: Request) {
  const url = new URL(req.url);
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
