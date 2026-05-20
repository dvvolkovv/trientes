import type { MarketRow, GlobalSnap } from "@/lib/coingecko";
import { KEYS, TTL } from "./keys";

// Minimal interfaces — we only use what we need so tests can pass fakes.
type RedisLike = {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

type PrismaLike = {
  coin: {
    upsert(args: {
      where: { id: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
  coinSnapshot: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  globalStats: {
    upsert(args: {
      where: { id: number };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export async function syncPrices(deps: {
  fetchTop100L1: () => Promise<MarketRow[]>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<{ count: number }> {
  const rows = await deps.fetchTop100L1();

  // Write Redis snapshot first — fast cache for readers.
  const listJson = JSON.stringify(rows);
  await deps.redis.set(KEYS.topList, listJson, "EX", TTL.snapshot);

  // Per-coin snapshot (used by future detail pages).
  for (const r of rows) {
    await deps.redis.set(KEYS.coin(r.id), JSON.stringify(r), "EX", TTL.snapshot);
  }

  // Durable writes.
  for (const r of rows) {
    const slug = r.id; // CoinGecko id is already a slug.
    await deps.prisma.coin.upsert({
      where: { id: r.id },
      update: {
        symbol: r.symbol,
        name: r.name,
        logoUrl: r.logoUrl,
        rank: r.rank,
      },
      create: {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        slug,
        rank: r.rank,
        logoUrl: r.logoUrl,
        source: "AUTO_L1",
      },
    });
    await deps.prisma.coinSnapshot.create({
      data: {
        coinId: r.id,
        priceUsd: r.priceUsd,
        marketCapUsd: r.marketCapUsd,
        volume24hUsd: r.volume24hUsd,
        pctChange1h: r.pctChange1h,
        pctChange24h: r.pctChange24h,
        pctChange7d: r.pctChange7d,
        circulatingSupply: r.circulatingSupply,
        totalSupply: r.totalSupply,
        maxSupply: r.maxSupply,
      },
    });
  }

  return { count: rows.length };
}

export async function syncGlobal(deps: {
  fetchGlobalSnap: () => Promise<GlobalSnap>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<void> {
  const snap = await deps.fetchGlobalSnap();
  await deps.redis.set(KEYS.globalStats, JSON.stringify(snap), "EX", TTL.globalStats);
  await deps.prisma.globalStats.upsert({
    where: { id: 1 },
    update: { ...snap },
    create: { id: 1, ...snap },
  });
}
