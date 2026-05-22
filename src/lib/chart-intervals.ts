// Timeframe button → Binance kline interval + how many candles to request.
// Binance caps a single klines request at 1000 candles.
export type Timeframe =
  | "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M" | "1y";

export const TIMEFRAMES: { key: Timeframe; label: string; interval: string; limit: number }[] = [
  // Sub-day buttons are candle-size zooms: pick the interval, see ~1000 of them.
  { key: "1s", label: "1S", interval: "1s", limit: 1000 },
  { key: "1m", label: "1m", interval: "1m", limit: 1000 },
  { key: "5m", label: "5m", interval: "5m", limit: 1000 },
  { key: "15m", label: "15m", interval: "15m", limit: 1000 },
  { key: "1h", label: "1H", interval: "1h", limit: 720 },
  { key: "4h", label: "4H", interval: "4h", limit: 720 },
  // Calendar buttons are time *ranges*, not candle sizes — the ladder runs from
  // seconds up to exactly one year. interval = granularity that yields a
  // readable candle count per range. (Previously 1D and 1Y were identical and
  // 1W/1M overshot to 5–10 years.)
  { key: "1d", label: "1D", interval: "5m", limit: 288 }, // 1 day   @ 5m
  { key: "1w", label: "1W", interval: "1h", limit: 168 }, // 1 week  @ 1h
  { key: "1M", label: "1M", interval: "4h", limit: 180 }, // 1 month @ 4h (~30d)
  { key: "1y", label: "1Y", interval: "1d", limit: 365 }, // 1 year  @ 1d
];

// Allowlist of Binance intervals the API route will proxy (request validation).
export const ALLOWED_INTERVALS = new Set([
  "1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M",
]);

// Intervals coarse enough to be worth caching in Redis (TTL in seconds).
export const CACHEABLE_INTERVAL_TTL: Record<string, number> = {
  "1h": 60,
  "4h": 300,
  "1d": 600,
  "1w": 1800,
  "1M": 3600,
};
