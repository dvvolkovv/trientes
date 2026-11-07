/**
 * Слайс C: сверка заявленных листингов с публичными API бирж и расчёт
 * собственного ценового индекса карточки.
 *
 * Принцип тот же, что в слайсе B для контрактов: мы не правим заявление
 * проекта, а показываем, что с ним стало при встрече с фактом. Пары, которой
 * нет в снимке биржи, достаётся `pair_not_found` — второй по важности сигнал
 * подделки после «по этому адресу нет контракта».
 */

import { getConnector, lookupTicker, normalizeExchange, type Ticker } from "@/lib/cex-registry";
import { ALL_CEX_IDS, getSnapshots, type SnapshotFetch, type SnapshotMap } from "@/lib/cex-snapshot";
import { parsePair } from "@/lib/pair";
import { computeIndex, type IndexCandidate, type IndexResult } from "@/lib/price-index";
import { mergeProvenance } from "@/lib/coin-card-provenance";
import { ANCHORS, quoteToUsd, USD_QUOTES, type AnchorPrices } from "@/lib/quote-usd";

export type MarketCheckError =
  | "exchange_unsupported"
  | "pair_unparsable"
  | "pair_not_found"
  | "base_mismatch"
  | "no_usd_route"
  | "exchange_unreachable"
  | "exchange_error";

export type MarketClaim = {
  id: string;
  kind: string;
  exchangeId: string | null;
  exchangeName: string;
  pair: string;
};

export type MarketFact = {
  nativeSymbol: string;
  quote: string;
  priceUsd: number;
  volumeUsd24h: number | null;
  changePct: number | null;
};

export type MarketCheck = { fact: MarketFact; error: null } | { fact: null; error: MarketCheckError };

/** Нормализованный id биржи для заявленного рынка, если мы умеем её читать. */
export function resolveExchange(claim: MarketClaim): string | null {
  if (claim.kind.toUpperCase() === "DEX") return null; // цены пулов — не этот слайс
  return normalizeExchange(claim.exchangeId) ?? normalizeExchange(claim.exchangeName);
}

/**
 * Сверка одного заявленного рынка со снимком биржи.
 * `cardSymbol` — тикер монеты: пара с чужой базой не подтверждается, иначе под
 * монету подставилась бы цена другой.
 */
export function checkMarket(
  claim: MarketClaim,
  cardSymbol: string,
  snapshots: SnapshotMap,
  anchors: AnchorPrices,
): MarketCheck {
  const exchangeId = resolveExchange(claim);
  if (!exchangeId) return { fact: null, error: "exchange_unsupported" };

  const connector = getConnector(exchangeId);
  const snapshot = snapshots.get(exchangeId);
  if (!connector) return { fact: null, error: "exchange_unsupported" };
  if (!snapshot) return { fact: null, error: "exchange_unreachable" };
  if ("error" in snapshot) return { fact: null, error: snapshot.error };

  const parsed = parsePair(claim.pair);
  if (!parsed) return { fact: null, error: "pair_unparsable" };
  if (parsed.base !== cardSymbol.trim().toUpperCase()) return { fact: null, error: "base_mismatch" };

  const ticker: Ticker | null = lookupTicker(connector, snapshot.tickers, parsed.base, parsed.quote);
  if (!ticker) return { fact: null, error: "pair_not_found" };

  const route = quoteToUsd(parsed.quote, anchors);
  if ("error" in route) return { fact: null, error: route.error };

  return {
    error: null,
    fact: {
      nativeSymbol: ticker.nativeSymbol,
      quote: parsed.quote,
      priceUsd: ticker.price * route.usd,
      volumeUsd24h: ticker.quoteVolume == null ? null : ticker.quoteVolume * route.usd,
      changePct: ticker.changePct,
    },
  };
}

/**
 * Цены опорных монет (BTC, ETH, BNB, SOL) по стейбл-парам тех же снимков.
 * Первый проход: без них крипто-котировки не переводятся в доллар.
 */
export function computeAnchorPrices(snapshots: SnapshotMap): AnchorPrices {
  const out: AnchorPrices = {};
  for (const anchor of ANCHORS) {
    const candidates: IndexCandidate[] = [];
    for (const [id, snapshot] of snapshots) {
      if ("error" in snapshot) continue;
      const connector = getConnector(id);
      if (!connector) continue;
      for (const quote of USD_QUOTES) {
        const ticker = lookupTicker(connector, snapshot.tickers, anchor, quote);
        if (!ticker) continue;
        candidates.push({
          id: `${id}:${ticker.nativeSymbol}`,
          priceUsd: ticker.price,
          volumeUsd24h: ticker.quoteVolume ?? 0,
          changePct: ticker.changePct,
        });
      }
    }
    const index = computeIndex(candidates);
    if (!("error" in index)) out[anchor] = index.priceUsd;
  }
  return out;
}

/* ─── прогон по базе ─────────────────────────────────────────────────────── */

type MarketRow = MarketClaim & { priceUsd: number | null; volumeUsd24h: number | null };

type CardRow = {
  id: string;
  symbol: string;
  provenance: unknown;
  markets: MarketRow[];
};

export type PrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<CardRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  coinCardMarket: {
    update(args: unknown): Promise<unknown>;
  };
  coinCardPriceIndex: {
    upsert(args: unknown): Promise<unknown>;
  };
  coinCardPricePoint: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
};

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

export type MarketSyncStats = {
  cards: number;
  marketsChecked: number;
  confirmed: number;
  failed: number;
  indexed: number;
};

/** Точка истории пишется на границе часа — отсюда @@unique([cardId, at]). */
export function hourBucket(now: Date): Date {
  const at = new Date(now);
  at.setUTCMinutes(0, 0, 0);
  return at;
}

export async function syncCardMarkets(args: {
  prisma: PrismaLike;
  redis?: RedisLike;
  fetchImpl?: SnapshotFetch;
  /** Одна карточка (ручное обновление) или вся очередь (воркер). */
  cardId?: string;
  limit?: number;
  now?: Date;
}): Promise<MarketSyncStats> {
  const { prisma, redis, fetchImpl, cardId } = args;
  const now = args.now ?? new Date();
  const limit = args.limit ?? 200;

  const cards = await prisma.coinCard.findMany({
    where: cardId ? { id: cardId } : { status: "APPROVED", markets: { some: {} } },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      symbol: true,
      provenance: true,
      markets: {
        select: {
          id: true, kind: true, exchangeId: true, exchangeName: true,
          pair: true, priceUsd: true, volumeUsd24h: true,
        },
      },
    },
  });

  const stats: MarketSyncStats = { cards: 0, marketsChecked: 0, confirmed: 0, failed: 0, indexed: 0 };
  if (cards.length === 0) return stats;

  const snapshots = await getSnapshots(ALL_CEX_IDS, { redis, fetchImpl });
  const anchors = computeAnchorPrices(snapshots);

  for (const card of cards) {
    stats.cards++;
    const candidates: IndexCandidate[] = [];
    const checks = new Map<string, MarketCheck>();

    for (const market of card.markets) {
      const check = checkMarket(market, card.symbol, snapshots, anchors);
      checks.set(market.id, check);
      stats.marketsChecked++;
      if (check.error) stats.failed++;
      else {
        stats.confirmed++;
        candidates.push({
          id: market.id,
          priceUsd: check.fact.priceUsd,
          volumeUsd24h: check.fact.volumeUsd24h ?? 0,
          changePct: check.fact.changePct,
        });
      }
    }

    const index = computeIndex(candidates);
    const outliers = new Set("error" in index ? [] : index.outlierIds);

    for (const market of card.markets) {
      const check = checks.get(market.id);
      if (!check) continue;
      if (check.error) {
        // Отвал биржи не стирает последнюю известную цену: исчезнувший рынок и
        // недоступная биржа — разные вещи, и вторая не должна выглядеть первой.
        const keepPrice = check.error === "exchange_unreachable" || check.error === "exchange_error";
        await prisma.coinCardMarket.update({
          where: { id: market.id },
          data: {
            checkedAt: now,
            checkError: check.error,
            confirmedAt: null,
            isOutlier: false,
            ...(keepPrice ? {} : { priceUsd: null, volumeUsd24h: null, change24h: null }),
          },
        });
        continue;
      }
      await prisma.coinCardMarket.update({
        where: { id: market.id },
        data: {
          nativeSymbol: check.fact.nativeSymbol,
          quote: check.fact.quote,
          priceUsd: check.fact.priceUsd,
          volumeUsd24h: check.fact.volumeUsd24h,
          change24h: check.fact.changePct,
          isOutlier: outliers.has(market.id),
          confirmedAt: now,
          checkedAt: now,
          checkError: null,
        },
      });
    }

    if ("error" in index) continue;
    stats.indexed++;
    await writeIndex({ prisma, card, index, now });
  }

  return stats;
}

async function writeIndex(args: {
  prisma: PrismaLike;
  card: { id: string; provenance: unknown };
  index: IndexResult;
  now: Date;
}): Promise<void> {
  const { prisma, card, index, now } = args;
  const data = {
    priceUsd: index.priceUsd,
    change24h: index.change24h,
    volumeUsd24h: index.volumeUsd24h,
    marketCount: index.marketCount,
    spreadPct: index.spreadPct,
    confidence: index.confidence,
    method: index.method,
    computedAt: now,
  };

  await prisma.coinCardPriceIndex.upsert({
    where: { cardId: card.id },
    update: data,
    create: { cardId: card.id, ...data },
  });

  const at = hourBucket(now);
  await prisma.coinCardPricePoint.upsert({
    where: { cardId_at: { cardId: card.id, at } },
    update: {
      priceUsd: index.priceUsd,
      volumeUsd24h: index.volumeUsd24h,
      marketCount: index.marketCount,
    },
    create: {
      cardId: card.id,
      at,
      priceUsd: index.priceUsd,
      volumeUsd24h: index.volumeUsd24h,
      marketCount: index.marketCount,
    },
  });

  const entry = { kind: "AGGREGATED" as const, source: String(index.marketCount), at: now.toISOString() };
  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      provenance: mergeProvenance(card.provenance, { price: entry, markets: entry }) as never,
    },
  });
}

/** История индекса хранится 90 дней: это ряд для графика, а не архив. */
export async function pruneCardPricePoints(args: {
  prisma: PrismaLike;
  now?: Date;
  days?: number;
}): Promise<number> {
  const now = args.now ?? new Date();
  const days = args.days ?? 90;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const { count } = await args.prisma.coinCardPricePoint.deleteMany({
    where: { at: { lt: cutoff } },
  });
  return count;
}
