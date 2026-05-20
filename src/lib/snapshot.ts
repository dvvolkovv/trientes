import type { MarketRow, GlobalSnap, ExchangeRates, Exchange } from "@/lib/coingecko";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { KEYS } from "@/lib/sync/keys";

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
      return JSON.parse(cached) as Exchange[];
    } catch {
      // fall through
    }
  }
  // DB fallback
  const rows = await prisma.exchange.findMany({
    orderBy: { trustScoreRank: "asc" },
    take: 100,
  });
  return rows.map((r) => ({
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
  }));
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

export async function readExchangeRates(): Promise<ExchangeRates | null> {
  const cached = await redisGet(KEYS.exchangeRates);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as ExchangeRates;
  } catch {
    return null;
  }
}
