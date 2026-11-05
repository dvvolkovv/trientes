// Market mood — the signal that decides whether the homepage shows the bull or the bear.
//
// Primary signal: market-cap-weighted 7-day price change across the Layer-1 list we
// already render. 7d (rather than 24h) keeps the artwork from flipping on intraday
// noise; a row falls back to its 24h change when the 7d field is missing. If no usable
// price data is cached, the Fear & Greed index decides (>= 50 = bull). Last resort: bull.

import type { MarketRow } from "@/lib/coingecko";
import type { FearGreed } from "@/lib/fear-greed";

export type MarketMood = "bull" | "bear";

export function computeMarketMood(
  rows: MarketRow[],
  fearGreed: FearGreed | null,
): MarketMood {
  let weightedSum = 0;
  let capSum = 0;

  for (const row of rows) {
    const pct = row.pctChange7d ?? row.pctChange24h;
    if (pct === null || !Number.isFinite(pct)) continue;
    const cap = row.marketCapUsd;
    if (!Number.isFinite(cap) || cap <= 0) continue;
    weightedSum += pct * cap;
    capSum += cap;
  }

  if (capSum > 0) return weightedSum >= 0 ? "bull" : "bear";
  if (fearGreed && Number.isFinite(fearGreed.value)) {
    return fearGreed.value >= 50 ? "bull" : "bear";
  }
  return "bull";
}
