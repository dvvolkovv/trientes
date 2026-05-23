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
  volumeUsd: number;
  tradeUrl: string | null;
};

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
    cur.volumeUsd += tk.volumeUsd;
    if (tk.volumeUsd > (repVolume.get(tk.exchange) ?? -Infinity)) {
      cur.base = tk.base;
      cur.target = tk.target;
      cur.priceUsd = tk.priceUsd;
      cur.tradeUrl = tk.tradeUrl;
      repVolume.set(tk.exchange, tk.volumeUsd);
    }
  }
  return [...byExchange.values()].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, limit);
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
