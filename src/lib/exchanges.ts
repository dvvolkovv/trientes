// Multi-exchange kline adapters. Each adapter normalizes a public REST
// candlestick response to oldest-first OHLCV. Only Binance offers 1-second
// candles + a simple per-symbol WebSocket; the others start at 1 minute and
// are refreshed by polling on the client.

import type { OHLCV } from "@/lib/binance-klines";
import { parseKline } from "@/lib/binance-klines";
import { CG_TO_BINANCE } from "@/lib/live/binance-mapping";

export type ExchangeId = "binance" | "bybit" | "kucoin" | "cryptocom" | "kraken";

export const EXCHANGES: { id: ExchangeId; label: string }[] = [
  { id: "binance", label: "Binance" },
  { id: "bybit", label: "Bybit" },
  { id: "kucoin", label: "KuCoin" },
  { id: "cryptocom", label: "Crypto.com" },
  { id: "kraken", label: "Kraken" },
];

// Canonical base ticker for a coin (e.g. "BTC"); null if not on our exchanges.
export function baseTicker(coinId: string): string | null {
  const b = CG_TO_BINANCE[coinId];
  return b ? b.replace(/USDT$/, "") : null;
}

// ---- Parsers (pure; exported for unit tests) -------------------------------

const n = (v: unknown) => Number(v);

export function parseBybit(raw: unknown): OHLCV[] {
  const list = (raw as { result?: { list?: unknown[] } })?.result?.list ?? [];
  // Bybit returns newest-first: [startMs, open, high, low, close, volume, turnover].
  return [...list]
    .reverse()
    .map((row) => {
      const t = row as (string | number)[];
      return { time: Math.floor(n(t[0]) / 1000), open: n(t[1]), high: n(t[2]), low: n(t[3]), close: n(t[4]), volume: n(t[5]) };
    });
}

export function parseKucoin(raw: unknown): OHLCV[] {
  const data = (raw as { data?: unknown[] })?.data ?? [];
  // KuCoin returns newest-first: [time(sec), open, close, high, low, volume, turnover].
  return [...data]
    .reverse()
    .map((row) => {
      const t = row as (string | number)[];
      return { time: n(t[0]), open: n(t[1]), high: n(t[3]), low: n(t[4]), close: n(t[2]), volume: n(t[5]) };
    });
}

export function parseCryptocom(raw: unknown): OHLCV[] {
  const data = (raw as { result?: { data?: unknown[] } })?.result?.data ?? [];
  // Oldest-first array of { o, h, l, c, v, t(ms) }.
  return data.map((row) => {
    const r = row as Record<string, unknown>;
    return { time: Math.floor(n(r.t) / 1000), open: n(r.o), high: n(r.h), low: n(r.l), close: n(r.c), volume: n(r.v) };
  });
}

export function parseKraken(raw: unknown): OHLCV[] {
  const result = (raw as { result?: Record<string, unknown> })?.result ?? {};
  const key = Object.keys(result).find((k) => k !== "last");
  if (!key) return [];
  const arr = (result[key] as unknown[]) ?? [];
  // [time(sec), open, high, low, close, vwap, volume, count].
  return arr.map((row) => {
    const t = row as (string | number)[];
    return { time: n(t[0]), open: n(t[1]), high: n(t[2]), low: n(t[3]), close: n(t[4]), volume: n(t[6]) };
  });
}

// ---- Adapters --------------------------------------------------------------

type Adapter = {
  supportsSecond: boolean;
  // canonical interval (1s,1m,5m,15m,1h,4h,1d,1w,1M) → exchange param, or null.
  intervalParam: Record<string, string>;
  url: (base: string, param: string, limit: number) => string;
  parse: (raw: unknown) => OHLCV[];
};

const KRAKEN_BASE: Record<string, string> = { BTC: "XBT" };

export const ADAPTERS: Record<ExchangeId, Adapter> = {
  binance: {
    supportsSecond: true,
    intervalParam: { "1s": "1s", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w", "1M": "1M" },
    url: (base, param, limit) =>
      `https://api.binance.com/api/v3/klines?symbol=${base}USDT&interval=${param}&limit=${Math.min(limit, 1000)}`,
    parse: (raw) => (raw as unknown[]).map(parseKline),
  },
  bybit: {
    supportsSecond: false,
    intervalParam: { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W", "1M": "M" },
    url: (base, param, limit) =>
      `https://api.bybit.com/v5/market/kline?category=spot&symbol=${base}USDT&interval=${param}&limit=${Math.min(limit, 1000)}`,
    parse: parseBybit,
  },
  kucoin: {
    supportsSecond: false,
    intervalParam: { "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1hour", "4h": "4hour", "1d": "1day", "1w": "1week" },
    url: (base, param) => `https://api.kucoin.com/api/v1/market/candles?type=${param}&symbol=${base}-USDT`,
    parse: parseKucoin,
  },
  cryptocom: {
    supportsSecond: false,
    intervalParam: { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1D", "1w": "7D", "1M": "1M" },
    url: (base, param) => `https://api.crypto.com/v2/public/get-candlestick?instrument_name=${base}_USDT&timeframe=${param}`,
    parse: parseCryptocom,
  },
  kraken: {
    supportsSecond: false,
    intervalParam: { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "1440", "1w": "10080" },
    url: (base, param) => `https://api.kraken.com/0/public/OHLC?pair=${KRAKEN_BASE[base] ?? base}USD&interval=${param}`,
    parse: parseKraken,
  },
};

export function isExchangeId(v: string): v is ExchangeId {
  return v in ADAPTERS;
}

export function exchangeSupports(id: ExchangeId, canonicalInterval: string): boolean {
  return canonicalInterval in ADAPTERS[id].intervalParam;
}

// Fetch + normalize klines from a given exchange. Returns oldest-first OHLCV,
// trimmed to the last `limit` candles. Throws on network / unsupported errors.
export async function fetchExchangeKlines(
  id: ExchangeId,
  base: string,
  canonicalInterval: string,
  limit: number,
): Promise<OHLCV[]> {
  const adapter = ADAPTERS[id];
  const param = adapter.intervalParam[canonicalInterval];
  if (!param) throw new Error(`${id} does not support interval ${canonicalInterval}`);
  const res = await fetch(adapter.url(base, param, limit), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${id} klines ${res.status}: ${body.slice(0, 160)}`);
  }
  const candles = adapter.parse(await res.json());
  return candles.slice(-limit);
}
