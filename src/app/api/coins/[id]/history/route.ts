import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchMarketChart } from "@/lib/coingecko";
import { readChartHistory } from "@/lib/chart-history-cache";
import { TIMEFRAME_DAYS } from "@/lib/sync/keys";

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

  try {
    // Кэш, сеть и запасная копия на случай отказа — в `chart-history-cache`.
    const { points, cache } = await readChartHistory(id, timeframe, {
      fetchChart: (coinId, tf) => fetchMarketChart(coinId, TIMEFRAME_DAYS[tf]),
      get: async (key) => {
        if (redis.status === "wait" || redis.status === "end") await redis.connect();
        return redis.get(key);
      },
      set: (key, value, ttl) => redis.set(key, value, "EX", ttl),
    });
    return NextResponse.json(points, { headers: { "x-cache": cache } });
  } catch (err) {
    return NextResponse.json(
      { error: `fetch_failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 },
    );
  }
}
