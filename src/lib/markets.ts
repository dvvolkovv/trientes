// Traditional markets via CNBC's public quote web service — key-less, in the spirit of
// the project's other public data sources. One request covers every instrument.
// Data is delayed/indicative, not real-time.
//
// Why not Stooq (the previous source) or CME directly: both refuse this server. Stooq
// drops the connection outright, and cmegroup.com bans the IP for "suspected web
// scraping" after a handful of calls — their Data Terms of Use forbid automated access.
// A licensed vendor (Twelve Data, Finnhub, FRED) is the eventual upgrade; see the
// markets design doc.

export type MarketGroup = "index" | "future" | "metal";
export type MarketUnit = "usd" | "pts";

export type MarketInstrument = {
  symbol: string; // CNBC symbol, e.g. ".DJI" for an index, "@CL.1" for a front-month future
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
  changePct: number | null; // session move
};

export const MARKET_INSTRUMENTS: MarketInstrument[] = [
  { symbol: ".DJI", name: "Dow Jones", group: "index", unit: "pts" },
  { symbol: ".IXIC", name: "Nasdaq Composite", group: "index", unit: "pts" },
  { symbol: ".SPX", name: "S&P 500", group: "index", unit: "pts" },
  { symbol: "@SP.1", name: "S&P 500 Futures", group: "future", unit: "pts" },
  { symbol: "@CL.1", name: "crude", group: "future", unit: "usd" },
  { symbol: "@NG.1", name: "natgas", group: "future", unit: "usd" },
  { symbol: "@GC.1", name: "gold", group: "metal", unit: "usd" },
  { symbol: "@SI.1", name: "silver", group: "metal", unit: "usd" },
  { symbol: "@PL.1", name: "platinum", group: "metal", unit: "usd" },
  { symbol: "@PA.1", name: "palladium", group: "metal", unit: "usd" },
];

// CNBC formats numbers for display: "51,523.06", "-3.44%", "-" or null when absent.
function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").replace(/%$/, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// "2026-11-05" (index, session close) or "2026-11-06T01:06:00.000-0500" (live future).
// The board labels the stamp as UTC, so shift offset timestamps accordingly.
function stamp(raw: unknown): { date: string | null; time: string | null } {
  if (typeof raw !== "string" || !raw) return { date: null, time: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, time: null };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { date: null, time: null };
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

type CnbcQuote = {
  symbol?: unknown;
  code?: unknown;
  last?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  change_pct?: unknown;
  last_time?: unknown;
};

// Maps a CNBC response body onto MARKET_INSTRUMENTS, preserving instrument order.
// Unknown symbols, error rows (code !== 0) and quotes without a price are dropped.
export function parseCnbcQuotes(body: string): MarketQuote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return [];
  }
  const result = (raw as { FormattedQuoteResult?: { FormattedQuote?: unknown } })?.FormattedQuoteResult
    ?.FormattedQuote;
  const rows: CnbcQuote[] = Array.isArray(result) ? result : result ? [result as CnbcQuote] : [];

  const bySymbol = new Map<string, CnbcQuote>();
  for (const row of rows) {
    if (typeof row?.symbol !== "string") continue;
    if (row.code !== 0 && row.code !== undefined) continue;
    bySymbol.set(row.symbol, row);
  }

  const out: MarketQuote[] = [];
  for (const inst of MARKET_INSTRUMENTS) {
    const row = bySymbol.get(inst.symbol);
    if (!row) continue;
    const last = num(row.last);
    if (last === null) continue;
    const open = num(row.open);
    const changePct = num(row.change_pct) ?? (open !== null && open > 0 ? ((last - open) / open) * 100 : null);
    out.push({
      ...inst,
      ...stamp(row.last_time),
      open,
      high: num(row.high),
      low: num(row.low),
      last,
      changePct,
    });
  }
  return out;
}

const QUOTE_URL = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol";
// The service 403s a bare client; a browser UA plus an Accept header is enough.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

// One request for the whole board; returns [] on any transport or parse failure so the
// caller can keep the previous snapshot rather than publish a blank board.
export async function fetchMarkets(timeoutMs = 10000): Promise<MarketQuote[]> {
  const symbols = MARKET_INSTRUMENTS.map((i) => i.symbol).join("|");
  const url =
    `${QUOTE_URL}?symbols=${encodeURIComponent(symbols)}` +
    `&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": UA },
        cache: "no-store",
        signal,
      });
      if (!res.ok) return [];
      return parseCnbcQuotes(await res.text());
    });
  } catch {
    return [];
  }
}
