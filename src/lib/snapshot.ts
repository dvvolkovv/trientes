import type { MarketRow, GlobalSnap, ExchangeRates, Exchange, TickerRow } from "@/lib/coingecko";
import { fetchTickers } from "@/lib/coingecko";
import { fetchNews, type NewsItem } from "@/lib/news";
import type { MarketQuote } from "@/lib/markets";
import { fetchFearGreed, type FearGreed } from "@/lib/fear-greed";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { KEYS, TTL } from "@/lib/sync/keys";
import { Prisma, type CoinSnapshot } from "@prisma/client";
import { mergeCuratedExchanges } from "@/lib/curated-exchanges";

type LatestSnapshotRow = {
  [K in keyof CoinSnapshot]: CoinSnapshot[K] | null;
} & { coinId: string };

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

/**
 * Порог свежести запасного пути — шесть часов, тот же, что у закреплённой строки
 * списка (слайс AW). В базе лежат и монеты, выпавшие из категории layer-1: их
 * цену не обновляет ни один прогон, и самому старому снимку живого прода без
 * этого порога было бы четыре недели. Показать такую цену как сегодняшнюю —
 * соврать, а список без пяти выпавших монет по-прежнему список.
 */
const FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Снимок без штампа времени остаётся: «не знаю, когда» — это не «знаю, что давно». */
function isFreshEnough(fetchedAt: Date | null): boolean {
  if (!(fetchedAt instanceof Date)) return true;
  return Date.now() - fetchedAt.getTime() <= FALLBACK_MAX_AGE_MS;
}

/** Разбор половины снимка: негодная строка — это «нет снимка», а не пустой список. */
function parseRows(cached: string | null): MarketRow[] | null {
  if (cached === null) return null;
  try {
    const parsed = JSON.parse(cached) as unknown;
    return Array.isArray(parsed) ? (parsed as MarketRow[]) : null;
  } catch {
    return null;
  }
}

/**
 * Список монет: снимок Redis целиком или база.
 *
 * Снимок состоит из двух половин с разным сроком жизни — основной список
 * (категория layer-1, 15 минут) и монеты, заведённые руками (час). Прогон цен
 * ходит раз в десять минут и иногда получает от CoinGecko 429: лимит бесплатного
 * тарифа считается по IP и общий у `trientes-web` с `trientes-worker`. Один
 * сорванный прогон — и основная половина истекает, а вторая остаётся на месте.
 *
 * Прежнее условие («есть хоть одна половина — отдаём её») в этом случае отдавало
 * **половину списка**: 19 ноября главная четверть часа показывала 27 монет,
 * заведённых руками, без биткойна и эфира. Поэтому снимок годен только целиком;
 * уцелела половина — читаем базу, где лежат снимки всех монет от последнего
 * удачного прогона. Пустой основной список считается сорванным чтением: в
 * категории layer-1 всегда около сотни монет, пустого рынка там не бывает.
 * Пустой список заведённых руками — законный ответ, таких монет может не быть.
 */
export async function readTop100(): Promise<MarketRow[]> {
  const [l1Cached, adminCached] = await Promise.all([
    redisGet(KEYS.topList),
    redisGet(KEYS.adminAddedList),
  ]);

  const l1 = parseRows(l1Cached);
  const admin = parseRows(adminCached);
  if (l1 !== null && l1.length > 0 && admin !== null) {
    return [...l1, ...admin];
  }
  const cachedHalf = [...(l1 ?? []), ...(admin ?? [])];

  // DB fallback: latest snapshot per active coin, ordered by rank.
  const coins = await prisma.coin.findMany({
    where: { isActive: true },
    orderBy: { rank: "asc" },
    take: 200,
  });
  const coinIds = coins.map((c) => c.id);
  if (coinIds.length === 0) return cachedHalf;

  const snapshots = await prisma.$queryRaw<LatestSnapshotRow[]>`
    SELECT
      s.id,
      c.id AS "coinId",
      s."priceUsd",
      s."marketCapUsd",
      s."volume24hUsd",
      s."pctChange1h",
      s."pctChange24h",
      s."pctChange7d",
      s."circulatingSupply",
      s."totalSupply",
      s."maxSupply",
      s."sparkline7d",
      s."fetchedAt"
    FROM "Coin" AS c
    LEFT JOIN LATERAL (
      SELECT *
      FROM "CoinSnapshot" AS snap
      WHERE snap."coinId" = c.id
      ORDER BY snap."fetchedAt" DESC
      LIMIT 1
    ) AS s ON TRUE
    WHERE c.id IN (${Prisma.join(coinIds)})
    ORDER BY c."rank" ASC
  `;
  const snapshotsByCoinId = new Map<string, LatestSnapshotRow>();
  for (const snapshot of snapshots) {
    if (snapshot.id !== null) snapshotsByCoinId.set(snapshot.coinId, snapshot);
  }
  const coinsWithSnapshots = coins.map((coin) => {
    const snapshot = snapshotsByCoinId.get(coin.id);
    return { ...coin, snapshots: snapshot ? [snapshot] : [] };
  });

  const fromDb = coinsWithSnapshots
    .filter((c) => c.snapshots[0] && isFreshEnough(c.snapshots[0].fetchedAt))
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
  // База молчит или пуста — уцелевшая половина снимка лучше пустой страницы.
  return fromDb.length > 0 ? fromDb : cachedHalf;
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
      description: null,
      exchangeType: null,
      currencies: null,
      pairsCount: null,
      fiats: [],
      socials: null,
      source: "cg" as const,
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
