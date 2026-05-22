export const KEYS = {
  topList: "snapshot:list:top100",
  adminAddedList: "snapshot:list:admin",
  exchangesList: "snapshot:exchanges:top100",
  coin: (id: string) => `snapshot:coin:${id}`,
  globalStats: "global:stats",
  exchangeRates: "exchange:rates",
  news: "news:latest",
} as const;

// TTLs sized to outlive the worker sync cadence (10/30/30 min on CoinGecko Free tier).
export const TTL = {
  snapshot: 900,        // 15 min — covers the 10 min price-sync interval with margin
  globalStats: 2400,    // 40 min — covers the 30 min global-sync interval
  exchangeRates: 2400,  // 40 min — rates barely move
  exchanges: 3600,         // 1h — list barely moves in scale
  adminAddedList: 3600,    // 1h
  news: 7200,              // 2h — outlives the 30 min news-sync + worker restarts
} as const;

export const HISTORY_KEY = (id: string, timeframe: string) => `coin:history:${id}:${timeframe}`;

export const HISTORY_TTL: Record<string, number> = {
  "1d": 5 * 60,        // 5 min
  "7d": 60 * 60,       // 1 hour
  "1m": 60 * 60,       // 1 hour
  "1y": 6 * 60 * 60,   // 6 hours
  "all": 24 * 60 * 60, // 1 day
};

export const TIMEFRAME_DAYS: Record<string, number | "max"> = {
  "1d": 1,
  "7d": 7,
  "1m": 30,
  "1y": 365,
  "all": "max",
};
