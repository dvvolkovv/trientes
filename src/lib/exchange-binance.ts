import { ALLOWED_INTERVALS } from "@/lib/chart-intervals";

const BINANCE_BASE = "https://api.binance.com";
const SYMBOL = /^[A-Z0-9]{4,30}$/;

export class ExchangeApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "ExchangeApiError";
  }
}

export type OHLCV = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Ticker24h = { lastPrice: number; priceChangePercent: number; volume: number; quoteVolume: number };
export type KlinesResult = { source: "binance"; symbol: string; interval: string; fetchedAt: number; candles: OHLCV[] };
export type TickerResult = { source: "binance"; symbol: string; fetchedAt: number } & Ticker24h;

export function parseSymbol(value: string | null): string {
  const symbol = (value ?? "").trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new ExchangeApiError(400, "invalid_symbol");
  return symbol;
}

export function parseInterval(value: string | null): string {
  const interval = value ?? "1h";
  if (!ALLOWED_INTERVALS.has(interval)) throw new ExchangeApiError(400, "invalid_interval");
  return interval;
}

export function parseLimit(value: string | null): number {
  const text = value ?? "500";
  if (!/^[0-9]+$/.test(text)) throw new ExchangeApiError(400, "invalid_limit");
  const limit = Number(text);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ExchangeApiError(400, "invalid_limit");
  return limit;
}

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const finite = (value: unknown): number => {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && DECIMAL_NUMBER.test(value.trim())) {
    n = Number(value.trim());
  } else {
    throw new ExchangeApiError(502, "upstream_shape");
  }
  if (!Number.isFinite(n)) throw new ExchangeApiError(502, "upstream_shape");
  return n;
};

export function parseKlines(raw: unknown): OHLCV[] {
  if (!Array.isArray(raw)) throw new ExchangeApiError(502, "upstream_shape");
  let previous = -1;
  return raw.map((item) => {
    if (!Array.isArray(item) || item.length < 6) throw new ExchangeApiError(502, "upstream_shape");
    const milliseconds = finite(item[0]);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new ExchangeApiError(502, "upstream_shape");
    const candle = {
      time: Math.floor(milliseconds / 1000),
      open: finite(item[1]),
      high: finite(item[2]),
      low: finite(item[3]),
      close: finite(item[4]),
      volume: finite(item[5]),
    };
    if (candle.time <= previous || candle.open <= 0 || candle.close <= 0 || candle.low <= 0 ||
        candle.high < Math.max(candle.open, candle.close, candle.low) ||
        candle.low > Math.min(candle.open, candle.close, candle.high) || candle.volume < 0) {
      throw new ExchangeApiError(502, "upstream_shape");
    }
    previous = candle.time;
    return candle;
  });
}

export function parseTicker(raw: unknown): Ticker24h {
  if (typeof raw !== "object" || raw === null) throw new ExchangeApiError(502, "upstream_shape");
  const r = raw as Record<string, unknown>;
  const ticker = {
    lastPrice: finite(r.lastPrice),
    priceChangePercent: finite(r.priceChangePercent),
    volume: finite(r.volume),
    quoteVolume: finite(r.quoteVolume),
  };
  if (ticker.lastPrice <= 0 || ticker.volume < 0 || ticker.quoteVolume < 0) throw new ExchangeApiError(502, "upstream_shape");
  return ticker;
}

async function getJson(path: string, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${BINANCE_BASE}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ExchangeApiError(502, "upstream_unavailable");
  }
  if (response.status === 400) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ExchangeApiError(502, "upstream_unavailable");
    }
    if (typeof body === "object" && body !== null && (body as Record<string, unknown>).code === -1121) {
      throw new ExchangeApiError(404, "pair_unavailable");
    }
    throw new ExchangeApiError(502, "upstream_unavailable");
  }
  if (response.status === 418 || response.status === 429) throw new ExchangeApiError(503, "upstream_rate_limited");
  if (!response.ok) throw new ExchangeApiError(502, "upstream_unavailable");
  try {
    return await response.json();
  } catch {
    throw new ExchangeApiError(502, "upstream_shape");
  }
}

export async function fetchExchangeKlines(symbol: string, interval: string, limit: number, fetcher: typeof fetch = fetch, now = Date.now()): Promise<KlinesResult> {
  const raw = await getJson(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, fetcher);
  return { source: "binance", symbol, interval, fetchedAt: now, candles: parseKlines(raw) };
}

export async function fetchExchangeTicker(symbol: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<TickerResult> {
  const raw = await getJson(`/api/v3/ticker/24hr?symbol=${symbol}`, fetcher);
  return { source: "binance", symbol, fetchedAt: now, ...parseTicker(raw) };
}

export function klinesTtl(interval: string): number {
  return ({ "1s": 2, "1m": 5, "5m": 10, "15m": 15, "1h": 60, "4h": 300, "1d": 600, "1w": 1800, "1M": 3600 } as Record<string, number>)[interval] ?? 5;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isSafeTimestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function parseCachedKlines(value: unknown, symbol: string, interval: string): KlinesResult | null {
  if (typeof value !== "object" || value === null) return null;
  const cached = value as Record<string, unknown>;
  if (cached.source !== "binance" || cached.symbol !== symbol || cached.interval !== interval ||
      !isSafeTimestamp(cached.fetchedAt) || !Array.isArray(cached.candles)) return null;
  const candles: OHLCV[] = [];
  let previous = -1;
  for (const item of cached.candles) {
    if (typeof item !== "object" || item === null) return null;
    const candle = item as Record<string, unknown>;
    const { time, open, high, low, close, volume } = candle;
    if (!Number.isSafeInteger(time) || (time as number) < 0 || (time as number) <= previous ||
        !isFiniteNumber(open) || !isFiniteNumber(high) || !isFiniteNumber(low) ||
        !isFiniteNumber(close) || !isFiniteNumber(volume) || open <= 0 || close <= 0 || low <= 0 ||
        high < Math.max(open, close, low) || low > Math.min(open, close, high) || volume < 0) return null;
    candles.push({ time: time as number, open, high, low, close, volume });
    previous = time as number;
  }
  return { source: "binance", symbol, interval, fetchedAt: cached.fetchedAt, candles };
}

export function parseCachedTicker(value: unknown, symbol: string): TickerResult | null {
  if (typeof value !== "object" || value === null) return null;
  const cached = value as Record<string, unknown>;
  const { fetchedAt, lastPrice, priceChangePercent, volume, quoteVolume } = cached;
  if (cached.source !== "binance" || cached.symbol !== symbol || !isSafeTimestamp(fetchedAt) ||
      !isFiniteNumber(lastPrice) || !isFiniteNumber(priceChangePercent) || !isFiniteNumber(volume) ||
      !isFiniteNumber(quoteVolume) || lastPrice <= 0 || volume < 0 || quoteVolume < 0) return null;
  return { source: "binance", symbol, fetchedAt, lastPrice, priceChangePercent, volume, quoteVolume };
}

export function exchangeErrorStatus(error: unknown): { status: number; code: string } {
  if (error instanceof ExchangeApiError) return { status: error.status, code: error.code };
  return { status: 502, code: "upstream_unavailable" };
}
