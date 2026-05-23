import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchOgPreview } from "@/lib/crypto-map";

export const dynamic = "force-dynamic";

const TTL = 86400; // 1d — a place's splash image changes slowly; negatives cached too.

// Fetch the OpenGraph splash (image/video/title) for a POI's own website. Lazy:
// the client only calls this when a marker popup opens. SSRF-guarded in fetchOgPreview.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = (url.searchParams.get("url") ?? "").trim();
  if (!target) return NextResponse.json({ preview: { title: null, image: null, video: null } });

  const cacheKey = `cmap:og:${target}`;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json({ preview: JSON.parse(cached) }, { headers: { "x-cache": "hit" } });
  } catch {
    // ignore — fall through to fetch
  }

  const preview = await fetchOgPreview(target); // never throws; degrades to empty
  try {
    await redis.set(cacheKey, JSON.stringify(preview), "EX", TTL);
  } catch {
    // best-effort cache write
  }
  return NextResponse.json({ preview }, { headers: { "x-cache": "miss" } });
}
