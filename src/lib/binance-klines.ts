export type OHLCV = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const BINANCE_BASE = "https://api.binance.com";

export function parseKline(tuple: unknown): OHLCV {
  const t = tuple as (string | number)[];
  return {
    time: Math.floor(Number(t[0]) / 1000),
    open: Number(t[1]),
    high: Number(t[2]),
    low: Number(t[3]),
    close: Number(t[4]),
    volume: Number(t[5]),
  };
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<OHLCV[]> {
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(
    symbol,
  )}&interval=${encodeURIComponent(interval)}&limit=${Math.min(limit, 1000)}`;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`binance klines ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as unknown[];
  if (!Array.isArray(raw)) throw new Error("binance klines: not an array");
  return raw.map(parseKline);
}
