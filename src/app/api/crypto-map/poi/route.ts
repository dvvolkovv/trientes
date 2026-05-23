import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseBbox, coinPaymentTags, fetchPois } from "@/lib/crypto-map";

export const dynamic = "force-dynamic";

const TTL = 21600; // 6h — on-the-ground acceptance data changes slowly.

// Round a bbox to ~0.05° (≈5km) so nearby viewports share a cache entry.
function roundKey(s: string): string {
  return s
    .split(",")
    .map((n) => (Math.round(Number(n) / 0.05) * 0.05).toFixed(2))
    .join(",");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bboxParam = url.searchParams.get("bbox");
  const coin = url.searchParams.get("coin") ?? "bitcoin";
  const symbol = url.searchParams.get("symbol") ?? "btc";

  const bbox = parseBbox(bboxParam);
  if (!bbox) return NextResponse.json({ error: "invalid bbox" }, { status: 400 });

  const coinTags = coinPaymentTags(coin, symbol);
  const cacheKey = `cmap:poi:${coin}:${roundKey(bboxParam!)}`;

  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json({ pois: JSON.parse(cached) }, { headers: { "x-cache": "hit" } });
    }
  } catch {
    // ignore — fall through to fetch
  }

  try {
    const pois = await fetchPois(bbox, coinTags);
    try {
      await redis.set(cacheKey, JSON.stringify(pois), "EX", TTL);
    } catch {
      // best-effort cache write
    }
    return NextResponse.json({ pois }, { headers: { "x-cache": "miss" } });
  } catch {
    // Source down / rate-limited — degrade to empty so the map still renders.
    return NextResponse.json({ pois: [] }, { headers: { "x-cache": "error" } });
  }
}
