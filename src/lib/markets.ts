// Traditional markets via Stooq — key-less, in the spirit of the project's other
// public data sources. Stooq's multi-symbol light quote is unreliable (returns N/D),
// so we fetch one symbol at a time. Data is delayed/indicative, not real-time.

export type MarketGroup = "index" | "future" | "metal";
export type MarketUnit = "usd" | "pts";

export type MarketInstrument = {
  symbol: string; // Stooq symbol, e.g. "^dji"
  name: string; // display name (proper nouns) or i18n key handled at render
  group: MarketGroup;
  unit: MarketUnit;
};

export type MarketQuote = MarketInstrument & {
  date: string | null;
  time: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  last: number | null; // close
  changePct: number | null; // session move (last vs open)
};

export const MARKET_INSTRUMENTS: MarketInstrument[] = [
  { symbol: "^dji", name: "Dow Jones", group: "index", unit: "pts" },
  { symbol: "^ndq", name: "Nasdaq Composite", group: "index", unit: "pts" },
  { symbol: "^spx", name: "S&P 500", group: "index", unit: "pts" },
  { symbol: "es.f", name: "E-mini S&P 500", group: "future", unit: "pts" },
  { symbol: "cl.f", name: "crude", group: "future", unit: "usd" },
  { symbol: "ng.f", name: "natgas", group: "future", unit: "usd" },
  { symbol: "xauusd", name: "gold", group: "metal", unit: "usd" },
  { symbol: "xagusd", name: "silver", group: "metal", unit: "usd" },
  { symbol: "xptusd", name: "platinum", group: "metal", unit: "usd" },
  { symbol: "xpdusd", name: "palladium", group: "metal", unit: "usd" },
];

type StooqQuote = {
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

// Stooq CSV row: Symbol,Date,Time,Open,High,Low,Close. Tolerates an optional header
// and trailing blank lines; "N/D" or non-numeric OHLC → null.
export function parseStooqQuote(csv: string): StooqQuote | null {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  const f = last.split(",");
  if (f.length < 7) return null;
  const [, date, time, openS, highS, lowS, closeS] = f;
  const open = Number(openS);
  const high = Number(highS);
  const low = Number(lowS);
  const close = Number(closeS);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  if (!date || date === "N/D") return null;
  return { date, time, open, high, low, close };
}

const STOOQ_URL = "https://stooq.com/q/l/";
const UA = "trientes.org markets (https://trientes.org)";

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMarketQuote(
  inst: MarketInstrument,
  timeoutMs = 8000,
): Promise<MarketQuote | null> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const url = `${STOOQ_URL}?s=${encodeURIComponent(inst.symbol)}&f=sd2t2ohlc&e=csv`;
      const res = await fetch(url, {
        headers: { accept: "text/csv", "user-agent": UA },
        cache: "no-store",
        signal,
      });
      if (!res.ok) return null;
      const q = parseStooqQuote(await res.text());
      if (!q) return null;
      const changePct = q.open > 0 ? ((q.close - q.open) / q.open) * 100 : null;
      return {
        ...inst,
        date: q.date,
        time: q.time,
        open: q.open,
        high: q.high,
        low: q.low,
        last: q.close,
        changePct,
      };
    });
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch every instrument one at a time (Stooq batching is unreliable); skip failures.
export async function fetchMarkets(): Promise<MarketQuote[]> {
  const out: MarketQuote[] = [];
  for (const inst of MARKET_INSTRUMENTS) {
    const q = await fetchMarketQuote(inst);
    if (q) out.push(q);
    await sleep(300);
  }
  return out;
}
