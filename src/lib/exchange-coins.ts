/**
 * Монеты, которыми торгует биржа, — для её карточки (слайс AD).
 *
 * Прежний раздел пар на карточке биржи читает `ExchangeMarket`, а эту таблицу
 * наполняли детальные вызовы CoinPaprika: бюджет шестьдесят запросов в час на
 * все биржи мира, и в проде таблица пуста по всем биржам. Поэтому список
 * считается из того, что у нас уже есть, — из **снимка всех тикеров биржи**
 * (один запрос, Redis на пять минут, тот же снимок, по которому слайс C
 * считает индекс цены).
 *
 * Идём не от снимка к монете, а от монеты к снимку: символ пары у каждой биржи
 * свой (`BTCUSDT`, `BTC-USD`, `XXBTZUSD`), и разбор его на базу и котировку —
 * гадание. Зато коннектор умеет собрать кандидатов символа по базе и котировке,
 * и каталог монет у нас конечный. Отсюда и честная формулировка раздела:
 * «монеты нашего каталога, которые эта биржа торгует», — монету, которой у нас
 * нет, мы не назовём и не должны.
 *
 * Главная опасность та же, что в посеве рынков (слайс X): тикер-двойник. `SAGA`
 * или `BAND` на бирже принадлежит и другому активу. Поэтому цена из снимка
 * сверяется с опорной — последним снимком CoinGecko. Как **значение** он тут не
 * нужен и в раздел не попадает, но как проверка порядка величины он честен.
 */

import type { CexConnector, TickerMap } from "./cex-registry";
import { lookupTicker } from "./cex-registry";
import { USD_QUOTES } from "./quote-usd";

/** Насколько цена биржи может расходиться с опорной, оставаясь той же монетой. */
export const COIN_PRICE_TOLERANCE = 0.25;
/** Старше этого опорная цена не защищает: за двое суток монета уходит дальше допуска. */
export const MAX_REFERENCE_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Котировки, в которых ищется пара, — только стейблы, принятые за доллар.
 * Крипто-котировку (`BTC`, `ETH`) не берём: её доллар считается через второе
 * наше число, и ошибка складывается из двух (слайс X это проверил живьём).
 */
export const COIN_QUOTES: readonly string[] = [...USD_QUOTES];

export type CoinCandidate = {
  id: string;
  symbol: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  /** Опорная цена и её время. `null` — опоры нет, монету не показываем. */
  reference: { priceUsd: number; fetchedAt: Date } | null;
};

export type ExchangeCoinRow = {
  id: string;
  symbol: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  /** Самая объёмная стейбл-пара монеты на этой бирже. */
  pair: string;
  /** Цена пары по снимку биржи — число самой биржи, а не наш индекс. */
  priceUsd: number;
  changePct: number | null;
  volumeUsd24h: number | null;
  /** Сколько стейбл-пар этой монеты биржа торгует (включая показанную). */
  pairs: number;
};

export type ExchangeCoinsResult = {
  rows: ExchangeCoinRow[];
  /** Пары, отвергнутые охранником цены: `SAGA/USDT`. */
  rejected: string[];
  /** Монет, которые биржа торгует, но у нас нет свежей опоры, — говорим вслух. */
  unverified: number;
};

function withinTolerance(priceUsd: number, referenceUsd: number): boolean {
  return Math.abs(priceUsd - referenceUsd) / referenceUsd <= COIN_PRICE_TOLERANCE;
}

/**
 * Монеты каталога, найденные в снимке биржи. Чистая функция: снимок и каталог
 * уже загружены вызывающим, сеть здесь не трогается.
 */
export function matchExchangeCoins(
  connector: CexConnector,
  tickers: TickerMap,
  coins: readonly CoinCandidate[],
  now: Date,
): ExchangeCoinsResult {
  const rows: ExchangeCoinRow[] = [];
  const rejected: string[] = [];
  let unverified = 0;

  for (const coin of coins) {
    const symbol = coin.symbol.trim().toUpperCase();
    if (!symbol) continue;

    type Hit = { pair: string; priceUsd: number; changePct: number | null; volumeUsd24h: number | null };
    const hits: Hit[] = [];
    for (const quote of COIN_QUOTES) {
      if (quote === symbol) continue; // стейбл сам себе не пара
      const ticker = lookupTicker(connector, tickers, symbol, quote);
      if (!ticker) continue;
      hits.push({
        pair: `${symbol}/${quote}`,
        // Котировка — стейбл, принятый за доллар: курс равен единице.
        priceUsd: ticker.price,
        changePct: ticker.changePct,
        volumeUsd24h: ticker.quoteVolume,
      });
    }
    if (hits.length === 0) continue;

    // Опора проверяется после поиска пары: счётчик должен говорить «скрыто
    // из-за опоры», а не «монет в каталоге больше, чем показано».
    const ref = coin.reference;
    const refUsable =
      ref != null && ref.priceUsd > 0 && now.getTime() - ref.fetchedAt.getTime() <= MAX_REFERENCE_AGE_MS;
    if (!refUsable) {
      unverified++;
      continue;
    }

    // Отдельная разошедшаяся пара — чужой актив под тем же тикером или
    // застрявшая котировка: такую не берём. Не осталось ни одной сошедшейся —
    // монеты в списке нет.
    const agreed = hits.filter((h) => {
      if (withinTolerance(h.priceUsd, ref.priceUsd)) return true;
      rejected.push(h.pair);
      return false;
    });
    if (agreed.length === 0) continue;

    const best = agreed.reduce((a, b) => ((b.volumeUsd24h ?? 0) > (a.volumeUsd24h ?? 0) ? b : a));
    rows.push({
      id: coin.id,
      symbol,
      name: coin.name,
      slug: coin.slug,
      logoUrl: coin.logoUrl,
      pair: best.pair,
      priceUsd: best.priceUsd,
      changePct: best.changePct,
      volumeUsd24h: best.volumeUsd24h,
      pairs: agreed.length,
    });
  }

  // Самые объёмные монеты вверх, пустой объём в хвосте, тай-брейк по символу —
  // ради воспроизводимости порядка между запросами.
  rows.sort(
    (a, b) => (b.volumeUsd24h ?? 0) - (a.volumeUsd24h ?? 0) || a.symbol.localeCompare(b.symbol),
  );
  return { rows, rejected, unverified };
}
