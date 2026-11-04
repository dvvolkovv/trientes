import { NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/exchange-cache";
import { exchangeErrorStatus, fetchExchangeTicker, parseCachedTicker, parseSymbol } from "@/lib/exchange-binance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const symbol = parseSymbol(new URL(req.url).searchParams.get("symbol"));
    const key = `exchange:ticker:${symbol}`;
    const cached = parseCachedTicker(await cacheGet<unknown>(key), symbol);
    if (cached) return NextResponse.json(cached, { headers: { "x-cache": "hit" } });
    const result = await fetchExchangeTicker(symbol);
    await cacheSet(key, result, 5);
    return NextResponse.json(result, { headers: { "x-cache": "miss" } });
  } catch (error) {
    const problem = exchangeErrorStatus(error);
    return NextResponse.json({ error: problem.code }, { status: problem.status });
  }
}
