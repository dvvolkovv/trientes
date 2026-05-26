import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { fetchCoinPaprikaExchangeDetail, type CoinPaprikaMarket } from "@/lib/coinpaprika";

export type ExchangeFresh = {
  cpId: string;
  volume24hUsd: number;
  currencies: number | null;
  pairsCount: number;
  fetchedAt: string; // ISO
};

const TTL_SECONDS = 60 * 5;
const NEG_TTL_SECONDS = 60; // short — try again soon if upstream is down/rate-limited

function marketRowId(exchangeId: string, m: CoinPaprikaMarket): string {
  const cat = m.category ?? "spot";
  return `${exchangeId}:${m.baseSymbol}:${m.quoteSymbol}:${cat}`;
}

async function hydrateMarkets(exchangeId: string, markets: CoinPaprikaMarket[]): Promise<void> {
  if (markets.length === 0) return;
  const now = new Date();
  for (const m of markets) {
    if (!m.baseSymbol || !m.quoteSymbol) continue;
    const id = marketRowId(exchangeId, m);
    const common = {
      pair: m.pair,
      baseSymbol: m.baseSymbol,
      quoteSymbol: m.quoteSymbol,
      baseCurrencyId: m.baseCurrencyId,
      quoteCurrencyId: m.quoteCurrencyId,
      category: m.category,
      priceUsd: m.priceUsd,
      volumeUsd24h: m.volumeUsd24h,
      volumeSharePct: m.volumeSharePct,
      outlier: m.outlier,
      marketUrl: m.marketUrl,
      lastTradedAt: m.lastTradedAt,
      lastSeenAt: now,
    };
    try {
      await prisma.exchangeMarket.upsert({
        where: { id },
        update: common,
        create: { id, exchangeId, firstSeenAt: now, ...common },
      });
    } catch {
      // ignore — exchange row may have been deleted, or transient db hiccup
    }
  }
  try {
    await prisma.exchange.update({
      where: { id: exchangeId },
      data: { marketsFetchedAt: now },
    });
  } catch {
    // ignore
  }
}

/**
 * Returns fresh aggregate metrics for an exchange from CoinPaprika, cached 5 min.
 * Also hydrates the ExchangeMarket table from the response so the pair table populates
 * for any exchange a user actually views (avoids relying on the rate-limited cron).
 * Falls back to null on upstream failure (caller should use DB values).
 */
export async function getFreshExchangeDetail(
  cpId: string,
  exchangeId: string,
): Promise<ExchangeFresh | null> {
  const key = `exch-fresh:${cpId}`;
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      if (cached === "") return null;
      return JSON.parse(cached) as ExchangeFresh;
    }
  } catch {
    // ignore
  }

  let detail;
  try {
    detail = await fetchCoinPaprikaExchangeDetail(cpId);
  } catch {
    detail = null;
  }

  if (!detail) {
    try {
      await redis.set(key, "", "EX", NEG_TTL_SECONDS);
    } catch {
      // ignore
    }
    return null;
  }

  // Fire-and-forget market hydration so the page render isn't blocked on DB writes.
  void hydrateMarkets(exchangeId, detail.markets);

  const fresh: ExchangeFresh = {
    cpId,
    volume24hUsd: detail.volume24hUsd,
    currencies: detail.currencies,
    pairsCount: detail.pairsCount,
    fetchedAt: new Date().toISOString(),
  };
  try {
    await redis.set(key, JSON.stringify(fresh), "EX", TTL_SECONDS);
  } catch {
    // ignore
  }
  return fresh;
}
