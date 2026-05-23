import type { Exchange } from "@/lib/coingecko";

// Exchanges absent from CoinGecko, curated by hand so they still appear in the
// directory and can be favorited. Upstream metrics (trust score, 24h volume) are
// unavailable, so they render as "—". Pinned ahead of the ranked CoinGecko list.
export const CURATED_EXCHANGES: Exchange[] = [
  {
    id: "richamster",
    name: "RichAmster",
    logoUrl: "https://richamster.com/icon.png",
    country: "Ukraine",
    yearEstablished: null,
    trustScore: null,
    trustScoreRank: null,
    volume24hBtc: 0,
    volume24hUsd: 0,
    url: "https://richamster.com",
    hasTradingIncentive: false,
  },
];

// Prepend curated entries, skipping any id CoinGecko already provides.
export function mergeCuratedExchanges(list: Exchange[]): Exchange[] {
  const have = new Set(list.map((e) => e.id));
  const extra = CURATED_EXCHANGES.filter((e) => !have.has(e.id));
  return [...extra, ...list];
}
