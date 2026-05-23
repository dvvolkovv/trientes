import type { MarketRow, GlobalSnap, ExchangeRates, Exchange, TickerRow } from "@/lib/coingecko";
import { fetchTickers } from "@/lib/coingecko";
import { fetchNews, type NewsItem } from "@/lib/news";
import type { MarketQuote } from "@/lib/markets";
import { fetchFearGreed, type FearGreed } from "@/lib/fear-greed";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { KEYS, TTL } from "@/lib/sync/keys";
import { mergeCuratedExchanges } from "@/lib/curated-exchanges";

async function redisGet(key: string): Promise<string | null> {
  if (redis.status === "wait" || redis.status === "end") {
    try {
      await redis.connect();
    } catch {
      return null;
    }
  }
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function readTop100(): Promise<MarketRow[]> {
  const [l1Cached, adminCached] = await Promise.all([
    redisGet(KEYS.topList),
    redisGet(KEYS.adminAddedList),
  ]);

  let l1: MarketRow[] = [];
  if (l1Cached) {
    try {
      l1 = JSON.parse(l1Cached) as MarketRow[];
    } catch {
      l1 = [];
    }
  }
  let admin: MarketRow[] = [];
  if (adminCached) {
    try {
      admin = JSON.parse(adminCached) as MarketRow[];
    } catch {
      admin = [];
    }
  }
  if (l1.length > 0 || admin.length > 0) {
    return [...l1, ...admin];
  }

  // DB fallback: latest snapshot per active coin, ordered by rank.
  const coins = await prisma.coin.findMany({
    where: { isActive: true },
    orderBy: { rank: "asc" },
    take: 200,
    include: {
      snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
  });

  return coins
    .filter((c) => c.snapshots[0])
    .map((c) => {
      const s = c.snapshots[0];
      return {
        id: c.id,
        symbol: c.symbol,
        name: c.name,
        logoUrl: c.logoUrl,
        rank: c.rank,
        priceUsd: Number(s.priceUsd),
        marketCapUsd: Number(s.marketCapUsd),
        volume24hUsd: Number(s.volume24hUsd),
        circulatingSupply: s.circulatingSupply ? Number(s.circulatingSupply) : null,
        totalSupply: s.totalSupply ? Number(s.totalSupply) : null,
        maxSupply: s.maxSupply ? Number(s.maxSupply) : null,
        pctChange1h: s.pctChange1h,
        pctChange24h: s.pctChange24h,
        pctChange7d: s.pctChange7d,
        sparkline7d: Array.isArray(s.sparkline7d) ? (s.sparkline7d as number[]) : null,
      };
    });
}

export async function readExchanges(): Promise<Exchange[]> {
  const cached = await redisGet(KEYS.exchangesList);
  if (cached) {
    try {
      return mergeCuratedExchanges(JSON.parse(cached) as Exchange[]);
    } catch {
      // fall through
    }
  }
  // DB fallback
  const rows = await prisma.exchange.findMany({
    orderBy: { trustScoreRank: "asc" },
    take: 300,
  });
  return mergeCuratedExchanges(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      logoUrl: r.logoUrl,
      country: r.country,
      yearEstablished: r.yearEstablished,
      trustScore: r.trustScore,
      trustScoreRank: r.trustScoreRank,
      volume24hBtc: r.volume24hBtc,
      volume24hUsd: r.volume24hUsd,
      url: r.url,
      hasTradingIncentive: r.hasTradingIncentive,
    })),
  );
}

export async function readGlobalStats(): Promise<GlobalSnap | null> {
  const cached = await redisGet(KEYS.globalStats);
  if (cached) {
    try {
      return JSON.parse(cached) as GlobalSnap;
    } catch {
      // fall through
    }
  }
  const row = await prisma.globalStats.findUnique({ where: { id: 1 } });
  if (!row) return null;
  return {
    totalMarketCapUsd: Number(row.totalMarketCapUsd),
    total24hVolumeUsd: Number(row.total24hVolumeUsd),
    btcDominancePct: row.btcDominancePct,
    ethDominancePct: row.ethDominancePct,
    activeCryptos: row.activeCryptos,
    markets: row.markets,
  };
}

export async function readMarkets(): Promise<MarketQuote[]> {
  const cached = await redisGet(KEYS.markets);
  if (!cached) return [];
  try {
    return JSON.parse(cached) as MarketQuote[];
  } catch {
    return [];
  }
}

export async function readExchangeRates(): Promise<ExchangeRates | null> {
  const cached = await redisGet(KEYS.exchangeRates);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as ExchangeRates;
  } catch {
    return null;
  }
}

export async function readNews(): Promise<NewsItem[]> {
  const cached = await redisGet(KEYS.news);
  if (cached) {
    try {
      return JSON.parse(cached) as NewsItem[];
    } catch {
      // fall through to a fresh fetch
    }
  }
  // Cold cache (worker hasn't populated it yet): fetch once so the banner shows
  // immediately, and best-effort warm the cache for the next reader.
  try {
    const items = await fetchNews();
    try {
      await redis.set(KEYS.news, JSON.stringify(items), "EX", TTL.news);
    } catch {
      // best-effort cache write
    }
    return items;
  } catch {
    return [];
  }
}

export async function readFearGreed(): Promise<FearGreed | null> {
  const cached = await redisGet(KEYS.fearGreed);
  if (cached) {
    try {
      return JSON.parse(cached) as FearGreed;
    } catch {
      // fall through to a fresh fetch
    }
  }
  // Cold cache (worker hasn't populated it yet): fetch once so the hero row shows
  // immediately, and best-effort warm the cache for the next reader.
  try {
    const fg = await fetchFearGreed();
    try {
      await redis.set(KEYS.fearGreed, JSON.stringify(fg), "EX", TTL.fearGreed);
    } catch {
      // best-effort cache write
    }
    return fg;
  } catch {
    return null;
  }
}

// Per-coin exchange tickers (every venue the coin lists on). Cached to bound
// CoinGecko /tickers calls; cold cache fetches live and best-effort warms it.
export async function readTickers(coinId: string): Promise<TickerRow[]> {
  const cached = await redisGet(KEYS.tickers(coinId));
  if (cached) {
    try {
      return JSON.parse(cached) as TickerRow[];
    } catch {
      // fall through to a fresh fetch
    }
  }
  try {
    const tickers = await fetchTickers(coinId);
    try {
      await redis.set(KEYS.tickers(coinId), JSON.stringify(tickers), "EX", TTL.tickers);
    } catch {
      // best-effort cache write
    }
    return tickers;
  } catch {
    return [];
  }
}
