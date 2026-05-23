import type { MarketRow, GlobalSnap, ExchangeRates, CoinDetail, Exchange } from "@/lib/coingecko";
import type { NewsItem } from "@/lib/news";
import type { FearGreed } from "@/lib/fear-greed";
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
        sparkline7d: r.sparkline7d,
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

export async function syncExchangeRates(deps: {
  fetchExchangeRates: () => Promise<ExchangeRates>;
  redis: RedisLike;
}): Promise<void> {
  const rates = await deps.fetchExchangeRates();
  await deps.redis.set(KEYS.exchangeRates, JSON.stringify(rates), "EX", TTL.exchangeRates);
}

export async function syncNews(deps: {
  fetchNews: () => Promise<NewsItem[]>;
  redis: RedisLike;
}): Promise<{ count: number }> {
  const items = await deps.fetchNews();
  await deps.redis.set(KEYS.news, JSON.stringify(items), "EX", TTL.news);
  return { count: items.length };
}

export async function syncFearGreed(deps: {
  fetchFearGreed: () => Promise<FearGreed>;
  redis: RedisLike;
}): Promise<{ value: number }> {
  const fg = await deps.fetchFearGreed();
  await deps.redis.set(KEYS.fearGreed, JSON.stringify(fg), "EX", TTL.fearGreed);
  return { value: fg.value };
}

type PrismaCoinMetaUpdate = {
  coin: {
    findMany(args: {
      where: { isActive: boolean; OR?: Array<unknown> };
      orderBy: { rank: "asc" };
      select: { id: true; metadataFetchedAt: true };
    }): Promise<Array<{ id: string; metadataFetchedAt: Date | null }>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

export async function syncCoinMetadata(deps: {
  fetchCoinDetail: (id: string) => Promise<CoinDetail>;
  prisma: PrismaCoinMetaUpdate;
  // ms between fetches — Free tier ~30 req/min → 2000ms is comfortable
  delayMs?: number;
  // skip coins fetched within this window (default 23h)
  staleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ updated: number; skipped: number; failed: number }> {
  const delayMs = deps.delayMs ?? 4000;
  // 7-day stale window — descriptions barely change, keeps monthly CoinGecko budget low.
  const staleMs = deps.staleMs ?? 7 * 24 * 60 * 60 * 1000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = Date.now();

  const coins = await deps.prisma.coin.findMany({
    where: { isActive: true },
    orderBy: { rank: "asc" },
    select: { id: true, metadataFetchedAt: true },
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of coins) {
    if (c.metadataFetchedAt && now - c.metadataFetchedAt.getTime() < staleMs) {
      skipped++;
      continue;
    }
    try {
      const d = await deps.fetchCoinDetail(c.id);
      await deps.prisma.coin.update({
        where: { id: c.id },
        data: {
          description: d.descriptionEn,
          websiteUrl: d.websiteUrl,
          explorerUrl: d.explorerUrl,
          whitepaperUrl: d.whitepaperUrl,
          githubUrl: d.githubUrl,
          twitterUrl: d.twitterUrl,
          redditUrl: d.redditUrl,
          metadataFetchedAt: new Date(),
        },
      });
      updated++;
    } catch (err) {
      failed++;
      console.error(`[worker] metadata-sync ${c.id} failed:`, err);
    }
    await sleep(delayMs);
  }

  return { updated, skipped, failed };
}

export async function syncExchanges(deps: {
  fetchExchanges: (btcUsd: number) => Promise<Exchange[]>;
  btcUsd: number;
  redis: RedisLike;
  prisma: {
    exchange: {
      upsert(args: {
        where: { id: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<unknown>;
    };
  };
}): Promise<{ count: number }> {
  const list = await deps.fetchExchanges(deps.btcUsd);
  await deps.redis.set(KEYS.exchangesList, JSON.stringify(list), "EX", TTL.exchanges);

  for (const e of list) {
    await deps.prisma.exchange.upsert({
      where: { id: e.id },
      update: {
        name: e.name,
        logoUrl: e.logoUrl,
        country: e.country,
        yearEstablished: e.yearEstablished,
        trustScore: e.trustScore,
        trustScoreRank: e.trustScoreRank,
        volume24hBtc: e.volume24hBtc,
        volume24hUsd: e.volume24hUsd,
        url: e.url,
        hasTradingIncentive: e.hasTradingIncentive,
      },
      create: {
        id: e.id,
        name: e.name,
        logoUrl: e.logoUrl,
        country: e.country,
        yearEstablished: e.yearEstablished,
        trustScore: e.trustScore,
        trustScoreRank: e.trustScoreRank,
        volume24hBtc: e.volume24hBtc,
        volume24hUsd: e.volume24hUsd,
        url: e.url,
        hasTradingIncentive: e.hasTradingIncentive,
      },
    });
  }
  return { count: list.length };
}

export async function syncAdminAddedPrices(deps: {
  // Returns admin-added coin ids; empty array means "nothing to do".
  listAdminAddedIds: () => Promise<string[]>;
  fetchByIds: (ids: string[]) => Promise<MarketRow[]>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<{ count: number }> {
  const ids = await deps.listAdminAddedIds();
  if (ids.length === 0) {
    // Clear stale snapshot so the public listing doesn't show orphaned admin coins.
    await deps.redis.set(KEYS.adminAddedList, JSON.stringify([]), "EX", TTL.adminAddedList);
    return { count: 0 };
  }

  const rows = await deps.fetchByIds(ids);
  await deps.redis.set(KEYS.adminAddedList, JSON.stringify(rows), "EX", TTL.adminAddedList);

  // Per-coin cache + DB snapshot, same as syncPrices.
  for (const r of rows) {
    await deps.redis.set(KEYS.coin(r.id), JSON.stringify(r), "EX", TTL.snapshot);
    await deps.prisma.coin.upsert({
      where: { id: r.id },
      update: {
        symbol: r.symbol,
        name: r.name,
        logoUrl: r.logoUrl,
        rank: r.rank,
      },
      // ADMIN_ADDED row already exists from approval; this branch is a defensive fallback.
      create: {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        slug: r.id,
        rank: r.rank,
        logoUrl: r.logoUrl,
        source: "ADMIN_ADDED",
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
        sparkline7d: r.sparkline7d,
      },
    });
  }
  return { count: rows.length };
}
