import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchKlines } from "@/lib/binance-klines";
import { fetchOhlc } from "@/lib/coingecko";
import { CG_TO_BINANCE } from "@/lib/live/binance-mapping";
import { ALLOWED_INTERVALS, CACHEABLE_INTERVAL_TTL } from "@/lib/chart-intervals";

export const dynamic = "force-dynamic";

// Maps a Binance interval to a CoinGecko `days` window for the fallback path.
function fallbackDays(interval: string): number {
  switch (interval) {
    case "1s":
    case "1m":
    case "5m":
    case "15m":
      return 1;
    case "1h":
      return 7;
    case "4h":
      return 30;
    case "1d":
    default:
      return 365;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const interval = url.searchParams.get("interval") ?? "1h";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "500") || 500, 1000);

  if (!/^[a-z0-9-]+$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }

  const symbol = CG_TO_BINANCE[id];
  const cacheKey = `coin:klines:${id}:${interval}:${limit}`;
  const ttl = CACHEABLE_INTERVAL_TTL[interval];

  // Try cache for coarse intervals only.
  if (symbol && ttl) {
    try {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(
          { source: "binance", candles: JSON.parse(cached) },
          { headers: { "x-cache": "hit" } },
        );
      }
    } catch {
      // ignore — fall through
    }
  }

  if (symbol) {
    try {
      const candles = await fetchKlines(symbol, interval, limit);
      if (ttl) {
        try {
          await redis.set(cacheKey, JSON.stringify(candles), "EX", ttl);
        } catch {
          // best-effort cache write
        }
      }
      return NextResponse.json({ source: "binance", candles }, { headers: { "x-cache": "miss" } });
    } catch {
      // fall through to CoinGecko fallback
    }
  }

  // Fallback: CoinGecko OHLC (coarser, no volume).
  try {
    const candles = await fetchOhlc(id, fallbackDays(interval));
    return NextResponse.json({ source: "coingecko", candles });
  } catch (err) {
    return NextResponse.json(
      { error: `fetch_failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 },
    );
  }
}
