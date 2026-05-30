import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseBbox, coinPaymentTags, fetchPois, type Poi } from "@/lib/crypto-map";
import { fetchApprovedPointsInBbox } from "@/lib/company-points";
import { fetchApprovedFintechHqInBbox } from "@/lib/fintech-pois";

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

  let osm: Poi[] = [];
  let osmCache: "hit" | "miss" | "error" = "miss";
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) {
      osm = JSON.parse(cached) as Poi[];
      osmCache = "hit";
    } else {
      osm = await fetchPois(bbox, coinTags);
      try {
        await redis.set(cacheKey, JSON.stringify(osm), "EX", TTL);
      } catch {
        // best-effort cache write
      }
    }
  } catch {
    // OSM source / redis down — leave osm empty, still merge company points below.
    osmCache = "error";
  }

  let company: Poi[] = [];
  try {
    company = await fetchApprovedPointsInBbox(bbox, coin);
  } catch {
    // DB hiccup — degrade to OSM only.
  }

  let fintech: Poi[] = [];
  try {
    fintech = await fetchApprovedFintechHqInBbox(bbox);
  } catch {
    // DB hiccup — degrade silently.
  }

  return NextResponse.json(
    { pois: [...fintech, ...company, ...osm] },
    { headers: { "x-cache": osmCache } },
  );
}
