// Pure helpers turning CoinGecko ticker rows into per-coin exchange listings.
// One source of truth for the coin-detail page: which venues to show in the
// "Top exchanges" table, and which of our kline adapters the coin is listed on.

import type { TickerRow } from "@/lib/coingecko";
import type { ExchangeId } from "@/lib/exchanges";

// A distinct exchange the coin lists on. volumeUsd is the summed 24h volume
// across all of that exchange's pairs; base/target/priceUsd/tradeUrl describe
// the single highest-volume pair, used as the representative row.
export type TopExchange = {
  exchange: string;
  base: string;
  target: string;
  priceUsd: number;
  /**
   * Объём за сутки. `null` — он неизвестен: у рынка нашего обмена ряд сделок
   * бывает не у каждой пары, и ноль читался бы как «сделок не было».
   */
  volumeUsd: number | null;
  tradeUrl: string | null;
};

/** Рынок карточки монеты — в той же форме, что строки рыночного фида. */
export type CardMarketRow = {
  exchangeName: string;
  pair: string;
  priceUsd: number | null;
  volumeUsd24h: number | null;
  tradeUrl: string | null;
};

/**
 * «Топ бирж» для монеты, которой нет в рыночном фиде.
 *
 * У карточки, посеянной нами или заявленной проектом, тикеров CoinGecko нет —
 * и раздел бирж на странице пропадал целиком, хотя биржа у монеты есть и её
 * рынок проверен (у Taler это наш собственный обмен). Берём рынки карточки как
 * они есть: цену подтвердила сверка, объём — служба заявок.
 */
export function cardTopExchanges(markets: readonly CardMarketRow[], limit = 20): TopExchange[] {
  const rows: TopExchange[] = [];
  for (const m of markets) {
    if (m.priceUsd == null || !(m.priceUsd > 0)) continue; // без цены строка пуста
    const parts = m.pair.trim().toUpperCase().split("/");
    if (parts.length !== 2) continue;
    rows.push({
      exchange: m.exchangeName,
      base: parts[0],
      target: parts[1],
      priceUsd: m.priceUsd,
      volumeUsd: m.volumeUsd24h,
      tradeUrl: m.tradeUrl,
    });
  }
  rows.sort(
    (a, b) =>
      (b.volumeUsd ?? -1) - (a.volumeUsd ?? -1) ||
      a.exchange.localeCompare(b.exchange) ||
      a.target.localeCompare(b.target),
  );
  return rows.slice(0, limit);
}

// Aggregate ticker rows into distinct exchanges, summing volume and keeping the
// busiest pair as the representative. Sorted by summed volume desc, capped.
export function topExchangesByVolume(tickers: TickerRow[], limit = 20): TopExchange[] {
  const byExchange = new Map<string, TopExchange>();
  const repVolume = new Map<string, number>(); // representative pair's own volume
  for (const tk of tickers) {
    const cur = byExchange.get(tk.exchange);
    if (!cur) {
      byExchange.set(tk.exchange, {
        exchange: tk.exchange,
        base: tk.base,
        target: tk.target,
        priceUsd: tk.priceUsd,
        volumeUsd: tk.volumeUsd,
        tradeUrl: tk.tradeUrl,
      });
      repVolume.set(tk.exchange, tk.volumeUsd);
      continue;
    }
    // Тикеры фида объём всегда называют, поэтому сумма здесь не теряет null.
    cur.volumeUsd = (cur.volumeUsd ?? 0) + tk.volumeUsd;
    if (tk.volumeUsd > (repVolume.get(tk.exchange) ?? -Infinity)) {
      cur.base = tk.base;
      cur.target = tk.target;
      cur.priceUsd = tk.priceUsd;
      cur.tradeUrl = tk.tradeUrl;
      repVolume.set(tk.exchange, tk.volumeUsd);
    }
  }
  return [...byExchange.values()]
    .sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0))
    .slice(0, limit);
}

// CoinGecko market names → our kline adapter ids. Only the five venues with
// adapters are listed; everything else has no chart source.
const NAME_TO_ADAPTER: Record<string, ExchangeId> = {
  Binance: "binance",
  Bybit: "bybit",
  KuCoin: "kucoin",
  "Crypto.com Exchange": "cryptocom",
  "Crypto.com": "cryptocom",
  Kraken: "kraken",
};

// The subset of adapter venues the coin is actually listed on.
export function listedAdapterExchanges(tickers: TickerRow[]): Set<ExchangeId> {
  const out = new Set<ExchangeId>();
  for (const tk of tickers) {
    const id = NAME_TO_ADAPTER[tk.exchange];
    if (id) out.add(id);
  }
  return out;
}
