/**
 * Рынок нашего собственного обмена в карточке монеты.
 *
 * Слайс C сверяет заявленные рынки со снимками бирж, и у монеты, которой нет ни
 * на одной бирже, цены не появляется никогда: у Taler рынков было ноль, а
 * значит ни цены, ни индекса, ни графика. При этом обмен на trientes.org этой
 * парой торгует — цену объявляет сам чейн.
 *
 * Поэтому рынок заявляем мы, а не проект, и значение пишет тот же код, что его
 * прочитал: у биржевых рынков автор цены — сверка слайса C, у этого — сеть.
 * Чтобы два автора не спорили за одну строку, рынок помечен именем биржи
 * `OWN_DEX_NAME`, и сверка слайса C его не трогает (`isOwnDexMarket`).
 *
 * Объём сеть не публикует: ни за сутки, ни за всё время. Поле остаётся пустым —
 * ноль означал бы «торгов не было», а это другое утверждение.
 */

import { readPairPrice, readSwapRegistry, type DexReadError, type FetchLike } from "@/lib/trientes-dex";
import { USD_QUOTES } from "@/lib/quote-usd";

/** Имя биржи в таблице рынков. Оно же — признак авторства значения. */
export const OWN_DEX_NAME = "Trientes DEX";
/** Сеть, в которой стоит обмен (не сеть монеты). */
export const OWN_DEX_CHAIN = "trientes";
/** Старше этого возраста цена нашего обмена в индекс не идёт. */
export const OWN_DEX_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function isOwnDexMarket(m: { kind: string; exchangeName: string }): boolean {
  return m.kind.toUpperCase() === "DEX" && m.exchangeName === OWN_DEX_NAME;
}

export type DexMarketFact = {
  pair: string;
  quote: string;
  priceUsd: number;
  spreadPct: number;
  markupPct: number;
};

export type DexMarketResult =
  | { fact: DexMarketFact; error: null }
  | { fact: null; error: DexReadError | "no_usd_route" };

export type DexMarketCard = { id: string; symbol: string };

/**
 * Цена монеты на нашем обмене, приведённая к доллару. Котировку берём только
 * стейбловую: курс крипто-котировки пришёл бы из второго нашего же числа, и
 * ошибка в нём удвоилась бы (тот же запрет, что в посеве рынков, слайс X).
 */
export async function readOwnDexMarket(
  card: DexMarketCard,
  fetchImpl: FetchLike = fetch,
): Promise<DexMarketResult> {
  const registry = await readSwapRegistry(fetchImpl);
  if ("error" in registry) return { fact: null, error: registry.error };

  const symbol = card.symbol.trim().toUpperCase();
  const base = registry.coins.find((c) => c.symbol === symbol && c.open);
  if (!base) return { fact: null, error: "pair_not_found" };

  // Котировки пары перечисляет сам реестр; берём первую стейбловую, в той
  // ориентации, в которой пара заведена в сети.
  const quoteSymbols = registry.pairs
    .filter((p) => p.base === base.ticker)
    .map((p) => registry.coins.find((c) => c.ticker === p.quote)?.symbol)
    .filter((s): s is string => !!s && USD_QUOTES.has(s));
  if (quoteSymbols.length === 0) return { fact: null, error: "no_usd_route" };

  let last: DexReadError = "pair_not_found";
  for (const quote of quoteSymbols) {
    const price = await readPairPrice(registry, symbol, quote, fetchImpl);
    if ("error" in price) {
      last = price.error;
      continue;
    }
    return {
      error: null,
      fact: {
        pair: price.pair,
        quote: price.quote,
        // Стейбл принимается за доллар — то же допущение, что в quote-usd.ts.
        priceUsd: price.price,
        spreadPct: price.spreadPct,
        markupPct: price.markupPct,
      },
    };
  }
  return { fact: null, error: last };
}

/* ─── запись ─────────────────────────────────────────────────────────────── */

export type PrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<DexMarketCard[]>;
  };
  coinCardMarket: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

export type DexMarketStats = {
  cards: number;
  written: number;
  failed: number;
  errors: Record<string, number>;
};

/**
 * Прогон по карточкам: у кого символ есть в реестре обмена — у того появляется
 * (или обновляется) строка рынка. Сбой чтения не стирает прежнюю цену, но и не
 * продлевает ей жизнь: индекс сам перестанет её брать через `OWN_DEX_MAX_AGE_MS`.
 */
export async function syncOwnDexMarkets(args: {
  prisma: PrismaLike;
  fetchImpl?: FetchLike;
  cardId?: string;
  now?: Date;
}): Promise<DexMarketStats> {
  const { prisma, cardId } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const now = args.now ?? new Date();
  const stats: DexMarketStats = { cards: 0, written: 0, failed: 0, errors: {} };

  const cards = await prisma.coinCard.findMany({
    where: cardId ? { id: cardId } : { status: "APPROVED" },
    select: { id: true, symbol: true },
    take: 500,
  });

  for (const card of cards) {
    const res = await readOwnDexMarket(card, fetchImpl);
    if (res.error) {
      // Нет пары — это не сбой карточки, а норма: таких карточек большинство.
      if (res.error !== "pair_not_found" && res.error !== "no_usd_route") {
        stats.failed++;
        stats.errors[res.error] = (stats.errors[res.error] ?? 0) + 1;
      }
      continue;
    }
    stats.cards++;
    const existing = await prisma.coinCardMarket.findFirst({
      where: { cardId: card.id, kind: "DEX", exchangeName: OWN_DEX_NAME },
      select: { id: true },
    });
    const data = {
      pair: res.fact.pair,
      nativeSymbol: res.fact.pair,
      quote: res.fact.quote,
      chain: OWN_DEX_CHAIN,
      priceUsd: res.fact.priceUsd,
      // Объём сеть не публикует — пусто, а не ноль.
      volumeUsd24h: null,
      change24h: null,
      isOutlier: false,
      confirmedAt: now,
      checkedAt: now,
      checkError: null,
    };
    if (existing) {
      await prisma.coinCardMarket.update({ where: { id: existing.id }, data });
    } else {
      await prisma.coinCardMarket.create({
        data: {
          cardId: card.id,
          kind: "DEX",
          exchangeId: null,
          exchangeName: OWN_DEX_NAME,
          tradeUrl: "https://trientes.org/exchange/",
          claimedAt: now,
          ...data,
        },
      });
    }
    stats.written++;
  }
  return stats;
}
