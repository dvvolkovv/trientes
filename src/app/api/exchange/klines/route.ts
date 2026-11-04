import { NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/exchange-cache";
import {
  exchangeErrorStatus,
  fetchExchangeKlines,
  klinesTtl,
  parseInterval,
  parseLimit,
  parseSymbol,
  type KlinesResult,
} from "@/lib/exchange-binance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const symbol = parseSymbol(query.get("symbol"));
    const interval = parseInterval(query.get("interval"));
    const limit = parseLimit(query.get("limit"));
    const key = `exchange:klines:${symbol}:${interval}:${limit}`;
    const cached = await cacheGet<KlinesResult>(key);
    if (cached) return NextResponse.json(cached, { headers: { "x-cache": "hit" } });
    const result = await fetchExchangeKlines(symbol, interval, limit);
    await cacheSet(key, result, klinesTtl(interval));
    return NextResponse.json(result, { headers: { "x-cache": "miss" } });
  } catch (error) {
    const problem = exchangeErrorStatus(error);
    return NextResponse.json({ error: problem.code }, { status: problem.status });
  }
}
