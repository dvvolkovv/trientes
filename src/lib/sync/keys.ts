export const KEYS = {
  topList: "snapshot:list:top100",
  coin: (id: string) => `snapshot:coin:${id}`,
  globalStats: "global:stats",
  exchangeRates: "exchange:rates",
} as const;

export const TTL = {
  snapshot: 90,         // seconds — must outlast the 60s sync interval
  globalStats: 300,     // 5 min
  exchangeRates: 600,   // 10 min — rates barely move
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
