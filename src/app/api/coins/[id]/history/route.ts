import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchMarketChart } from "@/lib/coingecko";
import { HISTORY_KEY, HISTORY_TTL, TIMEFRAME_DAYS } from "@/lib/sync/keys";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const timeframe = url.searchParams.get("timeframe") ?? "7d";

  if (!(timeframe in TIMEFRAME_DAYS)) {
    return NextResponse.json({ error: "invalid timeframe" }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const key = HISTORY_KEY(id, timeframe);

  // Try cache.
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(key);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { "x-cache": "hit" },
      });
    }
  } catch {
    // ignore — fall through to fetch
  }

  // Fetch from CoinGecko.
  try {
    const points = await fetchMarketChart(id, TIMEFRAME_DAYS[timeframe]);
    try {
      await redis.set(key, JSON.stringify(points), "EX", HISTORY_TTL[timeframe]);
    } catch {
      // best-effort cache write
    }
    return NextResponse.json(points, { headers: { "x-cache": "miss" } });
  } catch (err) {
    return NextResponse.json(
      { error: `fetch_failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 },
    );
  }
}
