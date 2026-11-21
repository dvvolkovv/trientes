export const KEYS = {
  topList: "snapshot:list:top100",
  adminAddedList: "snapshot:list:admin",
  // Строки, закреплённые в основном списке решением владельца (слайс AW).
  pinnedList: "snapshot:list:pinned",
  exchangesList: "snapshot:exchanges:top100",
  coin: (id: string) => `snapshot:coin:${id}`,
  globalStats: "global:stats",
  exchangeRates: "exchange:rates",
  news: "news:latest",
  fearGreed: "fng:latest",
  // Ключ поднимается при каждой смене ключей инструментов: слияние с прежним
  // снимком идёт по ним, и табло показало бы двадцать карточек вместо десяти.
  // v2 — переезд с записи CNBC («.SPX», «@GC.1») на запись Yahoo («^GSPC»,
  // «GC=F»); v3 — на свои ключи («DJI», «XAU»), потому что табло читается
  // четырьмя службами и запись одной из них больше ничего не значит.
  markets: "snapshot:markets:v3",
  // Наш собственный факт: о чём и когда мы спрашивали. По нему строится очередь
  // обхода — см. `marketFetchOrder`. Отдельный ключ, а не поле котировки:
  // спрос бывает и о том, что нам так и не отдали.
  marketsAsked: "snapshot:markets:asked",
  tickers: (id: string) => `tickers:${id}`,
} as const;

// TTLs sized to outlive the worker sync cadence (10/30/30 min on CoinGecko Free tier).
export const TTL = {
  snapshot: 900,        // 15 min — covers the 10 min price-sync interval with margin
  globalStats: 2400,    // 40 min — covers the 30 min global-sync interval
  exchangeRates: 2400,  // 40 min — rates barely move
  exchanges: 3600,         // 1h — list barely moves in scale
  adminAddedList: 3600,    // 1h
  pinnedList: 300,         // 5 min — главная пересобирается раз в минуту, числа меняются раз в час
  news: 7200,              // 2h — outlives the 30 min news-sync + worker restarts
  fearGreed: 21600,        // 6h — index updates ~daily; long TTL survives worker restarts
  markets: 86400,
  marketsAsked: 86400 * 7,  // 7d — очередь должна помнить спросы дольше, чем живёт само табло          // 24h — quotes are delayed anyway; survives an upstream outage, board shows its own asOf stamp
  tickers: 900,            // 15 min — bounds CoinGecko /tickers calls on the free tier
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
