import type { MarketRow, GlobalSnap } from "@/lib/coingecko";
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
  const cached = await redisGet(KEYS.topList);
  if (cached) {
    try {
      return JSON.parse(cached) as MarketRow[];
    } catch {
      // fall through to DB
    }
  }

  // DB fallback: latest snapshot per coin, ordered by rank.
  const coins = await prisma.coin.findMany({
    where: { isActive: true, source: "AUTO_L1" },
    orderBy: { rank: "asc" },
    take: 100,
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
      };
    });
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
