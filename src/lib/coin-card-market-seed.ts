/**
 * Посев рынков карточек, проверенных в сети (слайс X).
 *
 * Зачем он нужен: слайс C умеет сверять заявленный листинг со снимком биржи и
 * считать собственный индекс, но заявляет рынок проект. У карточки, посеянной
 * нами (слайсы V и W), проекта нет — поэтому рынков нет ни одного, прогон
 * `syncCardMarkets` выбирает карточки по `markets: { some: {} }` и не находит
 * ничего. Восемь коннекторов и взвешенная медиана простаивают, а следом за
 * ними молчат комиссия перевода в долларах, капитализация по проверенному
 * выпуску и график самостоятельной монеты.
 *
 * Что делает этот модуль: находит пары монеты в уже загруженных снимках бирж и
 * заводит их как рынки карточки. Цену он **не записывает** — это работа
 * слайса C, который подтвердит пару своим прогоном. Здесь рождается только
 * заявление «такая пара на такой бирже есть», и автор заявления — мы.
 *
 * Главная опасность — тикер-двойник: `SAGA` или `BAND` на какой-нибудь бирже
 * принадлежит другому активу, и его цена молча приедет на нашу карточку
 * (охранник `base_mismatch` слайса C от этого не спасает — база совпадает).
 * Поэтому найденная цена сверяется с опорной. Опорная берётся из снимка
 * CoinGecko: как **значение** он нам не нужен и в карточку не попадает, но как
 * проверка порядка величины он честен — чужой актив расходится с ним в разы.
 * Нет свежей опорной цены — не сеем и говорим об этом вслух.
 */

import { CEX, lookupTicker } from "./cex-registry";
import type { SnapshotMap } from "./cex-snapshot";
import { quoteToUsd, USD_QUOTES, type AnchorPrices } from "./quote-usd";

/** Насколько найденная цена может расходиться с опорной, оставаясь той же монетой. */
export const PRICE_TOLERANCE = 0.25;
/** Сколько рынков максимум сеется одной карточке. */
export const MAX_SEEDED_MARKETS = 16;
/** Старше этого опорная цена не защищает: за неделю монета уходит дальше допуска. */
export const MAX_REFERENCE_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Котировки, в которых ищется пара, — только стейблы. Крипто-котировку
 * (`BTC`, `ETH`) мы сознательно не сеем: её цена в долларах приходит через два
 * наших числа — цену пары и наш же индекс опорной монеты, — поэтому ошибка
 * складывается из двух, а объём такой пары, переведённый по курсу биткойна,
 * оказывается больше всех стейбл-рынков вместе. Живой прогон это показал:
 * `KSM/BTC` и `POLYX/BTC` разошлись со стейбл-парами на 55–60 %. Пару в
 * крипто-котировке, заявленную проектом, слайс C по-прежнему проверяет — мы
 * лишь не заводим такие от себя.
 */
export const SEED_QUOTES: readonly string[] = [...USD_QUOTES];

export type DiscoveredMarket = {
  exchangeId: string;
  exchangeName: string;
  pair: string;
  /** Только для глаз человека в `--dump`: в базу цена пишется слайсом C. */
  priceUsd: number;
  volumeUsd24h: number | null;
};

export type DiscoverError = "no_reference" | "no_pairs" | "reference_conflict";

export type DiscoverResult = {
  markets: DiscoveredMarket[];
  /** Пары, отвергнутые охранником цены: `binance:SAGA/USDT`. */
  rejected: string[];
  error: DiscoverError | null;
};

export type SeedTarget = {
  symbol: string;
  /** Опорная цена и её время. `null` — опоры нет, сеять нельзя. */
  reference: { priceUsd: number; fetchedAt: Date } | null;
};

function withinTolerance(priceUsd: number, referenceUsd: number): boolean {
  return Math.abs(priceUsd - referenceUsd) / referenceUsd <= PRICE_TOLERANCE;
}

/**
 * Пары монеты, найденные в снимках бирж. Чистая функция: снимки и курсы
 * опорных монет уже загружены вызывающим (одним запросом на биржу, как в
 * слайсе C), сеть здесь не трогается.
 */
export function discoverCardMarkets(
  target: SeedTarget,
  snapshots: SnapshotMap,
  anchors: AnchorPrices,
  now: Date,
): DiscoverResult {
  const symbol = target.symbol.trim().toUpperCase();
  const rejected: string[] = [];

  const ref = target.reference;
  if (!symbol) return { markets: [], rejected, error: "no_pairs" };
  if (!ref || !(ref.priceUsd > 0)) return { markets: [], rejected, error: "no_reference" };
  if (now.getTime() - ref.fetchedAt.getTime() > MAX_REFERENCE_AGE_MS)
    return { markets: [], rejected, error: "no_reference" };

  const found: DiscoveredMarket[] = [];
  // Спор считается по биржам, а не по объёму: объём сообщает та же сторона,
  // чью цену мы и проверяем, и у застрявшей в снимке пары он бывает больше,
  // чем у всех живых рынков монеты (`POLYX/BUSD` — 548 тыс. при цене вчетверо
  // выше стейбл-пар). Биржа же либо согласна с опорой хоть одной парой, либо
  // не согласна ни одной.
  const agree = new Set<string>();
  const disagree = new Set<string>();
  for (const connector of CEX) {
    const snapshot = snapshots.get(connector.id);
    if (!snapshot || "error" in snapshot) continue;

    for (const quote of SEED_QUOTES) {
      if (quote === symbol) continue; // пара монеты с собой — не рынок
      const ticker = lookupTicker(connector, snapshot.tickers, symbol, quote);
      if (!ticker) continue;
      const route = quoteToUsd(quote, anchors);
      if ("error" in route) continue; // опорная монета ещё не посчитана

      const priceUsd = ticker.price * route.usd;
      const pair = `${symbol}/${quote}`;
      const volumeUsd24h = ticker.quoteVolume == null ? null : ticker.quoteVolume * route.usd;
      if (!withinTolerance(priceUsd, ref.priceUsd)) {
        rejected.push(`${connector.id}:${pair}`);
        disagree.add(connector.id);
        continue;
      }
      agree.add(connector.id);
      found.push({
        exchangeId: connector.id,
        exchangeName: connector.label,
        pair,
        priceUsd,
        volumeUsd24h,
      });
    }
  }

  // Отдельная разошедшаяся пара на бирже, которая в остальном с опорой
  // согласна, — застрявший делистинг или мёртвая котировка: такую просто не
  // берём. Но если бирж, не согласных ни одной парой, не меньше, чем
  // согласных, спор идёт не о тикере-двойнике, а о самой цене монеты, и
  // разрешать его молча в пользу опоры нельзя: получится, что мы выбрали
  // меньший рынок за то, что он сошёлся с CoinGecko. Такая карточка не сеется
  // вовсе, а причина уходит человеку.
  const conflicting = [...disagree].filter((id) => !agree.has(id));
  if (conflicting.length > 0 && conflicting.length >= agree.size)
    return { markets: [], rejected, error: "reference_conflict" };
  if (found.length === 0) return { markets: [], rejected, error: "no_pairs" };

  // Самые объёмные рынки важнее: индекс взвешен по объёму, и лимит должен
  // отрезать хвост, а не голову. Тай-брейк по имени — ради воспроизводимости.
  found.sort(
    (a, b) =>
      (b.volumeUsd24h ?? 0) - (a.volumeUsd24h ?? 0) ||
      `${a.exchangeId}${a.pair}`.localeCompare(`${b.exchangeId}${b.pair}`),
  );
  return { markets: found.slice(0, MAX_SEEDED_MARKETS), rejected, error: null };
}

/* ─── прогон по базе ─────────────────────────────────────────────────────── */

export type SeedCardRow = {
  id: string;
  slug: string;
  symbol: string;
  coin: { snapshots: { priceUsd: unknown; fetchedAt: Date }[] } | null;
};

export type PrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<SeedCardRow[]>;
  };
  coinCardMarket: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
};

export type CardPlan = {
  cardId: string;
  slug: string;
  symbol: string;
  referenceUsd: number | null;
  result: DiscoverResult;
};

export type MarketSeedStats = {
  cards: number;
  created: number;
  noReference: number;
  noPairs: number;
  /** Спор о цене монеты, а не о тикере: решает человек. */
  conflict: number;
  rejected: number;
};

/** `Decimal` приходит объектом: строка — единственный безопасный путь к числу. */
export function referenceOf(row: SeedCardRow): { priceUsd: number; fetchedAt: Date } | null {
  const snap = row.coin?.snapshots?.[0];
  if (!snap) return null;
  const price = Number(String(snap.priceUsd));
  if (!Number.isFinite(price) || price <= 0) return null;
  return { priceUsd: price, fetchedAt: snap.fetchedAt };
}

/**
 * Карточки, которым сеются рынки: открытые, посеянные нами (ни куратора, ни
 * компании) и пока без ни одного рынка. Чужая заявка не трогается — её рынки
 * заявляет проект, и дописывать в неё свои мы не вправе.
 */
export function seedWhere(cardId?: string): unknown {
  if (cardId) return { id: cardId };
  return {
    status: "APPROVED",
    stewardUserId: null,
    companyId: null,
    nativeChain: { not: null },
    markets: { none: {} },
  };
}

export async function seedCardMarkets(args: {
  prisma: PrismaLike;
  snapshots: SnapshotMap;
  anchors: AnchorPrices;
  cardId?: string;
  limit?: number;
  /** `--dump`: посчитать и показать, в базу не писать. */
  dryRun?: boolean;
  now?: Date;
}): Promise<{ stats: MarketSeedStats; plans: CardPlan[] }> {
  const now = args.now ?? new Date();
  const rows = await args.prisma.coinCard.findMany({
    where: seedWhere(args.cardId),
    orderBy: [{ slug: "asc" }],
    take: args.limit ?? 200,
    select: {
      id: true,
      slug: true,
      symbol: true,
      coin: {
        select: {
          snapshots: {
            orderBy: { fetchedAt: "desc" },
            take: 1,
            select: { priceUsd: true, fetchedAt: true },
          },
        },
      },
    },
  });

  const stats: MarketSeedStats = {
    cards: 0, created: 0, noReference: 0, noPairs: 0, conflict: 0, rejected: 0,
  };
  const plans: CardPlan[] = [];

  for (const row of rows) {
    stats.cards++;
    const reference = referenceOf(row);
    const result = discoverCardMarkets({ symbol: row.symbol, reference }, args.snapshots, args.anchors, now);
    stats.rejected += result.rejected.length;
    if (result.error === "no_reference") stats.noReference++;
    if (result.error === "no_pairs") stats.noPairs++;
    if (result.error === "reference_conflict") stats.conflict++;
    plans.push({
      cardId: row.id,
      slug: row.slug,
      symbol: row.symbol,
      referenceUsd: reference?.priceUsd ?? null,
      result,
    });

    if (args.dryRun || result.markets.length === 0) continue;
    const { count } = await args.prisma.coinCardMarket.createMany({
      data: result.markets.map((m) => ({
        cardId: row.id,
        kind: "CEX",
        exchangeId: m.exchangeId,
        exchangeName: m.exchangeName,
        pair: m.pair,
        claimedAt: now,
      })),
      skipDuplicates: true,
    });
    stats.created += count;
  }

  return { stats, plans };
}
