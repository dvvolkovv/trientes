export type MarketRow = {
  id: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  rank: number;
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  pctChange1h: number | null;
  pctChange24h: number | null;
  pctChange7d: number | null;
  sparkline7d: number[] | null;
};

export type GlobalSnap = {
  totalMarketCapUsd: number;
  total24hVolumeUsd: number;
  btcDominancePct: number;
  ethDominancePct: number;
  activeCryptos: number;
  markets: number;
};

function req<T>(v: T | undefined | null, name: string): T {
  if (v === undefined || v === null) {
    throw new Error(`coingecko: missing required field ${name}`);
  }
  return v;
}

export function parseMarketRow(raw: unknown): MarketRow {
  const r = raw as Record<string, unknown>;
  const spark = (r.sparkline_in_7d as { price?: unknown } | null)?.price;
  const sparkline7d = Array.isArray(spark) && spark.every((n) => typeof n === "number")
    ? (spark as number[])
    : null;
  return {
    id: req(r.id as string | undefined, "id"),
    symbol: String(req(r.symbol as string | undefined, "symbol")).toUpperCase(),
    name: req(r.name as string | undefined, "name"),
    logoUrl: (r.image as string | null) ?? null,
    rank: req(r.market_cap_rank as number | undefined, "market_cap_rank"),
    priceUsd: req(r.current_price as number | undefined, "current_price"),
    marketCapUsd: req(r.market_cap as number | undefined, "market_cap"),
    volume24hUsd: req(r.total_volume as number | undefined, "total_volume"),
    circulatingSupply: (r.circulating_supply as number | null) ?? null,
    totalSupply: (r.total_supply as number | null) ?? null,
    maxSupply: (r.max_supply as number | null) ?? null,
    pctChange1h: (r.price_change_percentage_1h_in_currency as number | null) ?? null,
    pctChange24h: (r.price_change_percentage_24h_in_currency as number | null) ?? null,
    pctChange7d: (r.price_change_percentage_7d_in_currency as number | null) ?? null,
    sparkline7d,
  };
}

export function parseGlobal(raw: unknown): GlobalSnap {
  const root = raw as { data?: Record<string, unknown> };
  const d = req(root.data, "data");
  const totalMc = (d.total_market_cap as Record<string, number> | undefined)?.usd;
  const totalVol = (d.total_volume as Record<string, number> | undefined)?.usd;
  const dom = (d.market_cap_percentage as Record<string, number> | undefined) ?? {};
  return {
    totalMarketCapUsd: req(totalMc, "total_market_cap.usd"),
    total24hVolumeUsd: req(totalVol, "total_volume.usd"),
    btcDominancePct: req(dom.btc, "market_cap_percentage.btc"),
    ethDominancePct: req(dom.eth, "market_cap_percentage.eth"),
    activeCryptos: req(d.active_cryptocurrencies as number | undefined, "active_cryptocurrencies"),
    markets: req(d.markets as number | undefined, "markets"),
  };
}

const CG_BASE = "https://api.coingecko.com/api/v3";

async function cgFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${CG_BASE}${path}?${qs}`;
  // Retry once on 429 — Free tier occasionally bursts past limits.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 15_000));
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`coingecko ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error(`coingecko ${path}: unreachable`);
}

export async function fetchTop100L1(): Promise<MarketRow[]> {
  const raw = await cgFetch("/coins/markets", {
    vs_currency: "usd",
    category: "layer-1",
    order: "market_cap_desc",
    per_page: "100",
    page: "1",
    sparkline: "true",
    price_change_percentage: "1h,24h,7d",
  });
  if (!Array.isArray(raw)) throw new Error("coingecko /coins/markets: not an array");
  // Some coins in the L1 category occasionally come back with null market_cap_rank
  // (e.g. wrapped/inactive listings). Drop them — they can't be sensibly placed in the table.
  const filtered = (raw as Array<Record<string, unknown>>).filter(
    (r) => typeof r.market_cap_rank === "number",
  );
  return filtered.map(parseMarketRow);
}

export async function fetchGlobalSnap(): Promise<GlobalSnap> {
  const raw = await cgFetch("/global", {});
  return parseGlobal(raw);
}

export type ExchangeRate = { name: string; unit: string; value: number; type: "crypto" | "fiat" };
export type ExchangeRates = Record<string, ExchangeRate>;

export function parseExchangeRates(raw: unknown): ExchangeRates {
  const root = raw as { rates?: Record<string, unknown> };
  const rates = req(root.rates, "rates");
  const out: ExchangeRates = {};
  for (const [code, v] of Object.entries(rates)) {
    const r = v as Record<string, unknown>;
    if (typeof r.value !== "number") continue;
    out[code] = {
      name: String(r.name ?? code),
      unit: String(r.unit ?? code.toUpperCase()),
      value: r.value,
      type: r.type === "fiat" ? "fiat" : "crypto",
    };
  }
  return out;
}

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  const raw = await cgFetch("/exchange_rates", {});
  return parseExchangeRates(raw);
}

export type CoinDetail = {
  id: string;
  descriptionEn: string | null;
  websiteUrl: string | null;
  explorerUrl: string | null;
  whitepaperUrl: string | null;
  githubUrl: string | null;
  twitterUrl: string | null;
  redditUrl: string | null;
};

export type ChartPoint = { time: number; value: number }; // unix seconds, price USD

export type TickerRow = {
  exchange: string;
  base: string;
  target: string;
  priceUsd: number;
  volumeUsd: number;
  tradeUrl: string | null;
};

function firstString(arr: unknown): string | null {
  if (!Array.isArray(arr)) return null;
  const first = arr.find((x) => typeof x === "string" && x.length > 0);
  return typeof first === "string" ? first : null;
}

export function parseCoinDetail(raw: unknown): CoinDetail {
  const r = raw as Record<string, unknown>;
  const desc = (r.description as Record<string, unknown> | undefined)?.en;
  const links = (r.links as Record<string, unknown> | undefined) ?? {};
  const repos = (links.repos_url as Record<string, unknown> | undefined) ?? {};
  const twitter = links.twitter_screen_name as string | undefined;

  return {
    id: req(r.id as string | undefined, "id"),
    descriptionEn: typeof desc === "string" && desc.length > 0 ? desc : null,
    websiteUrl: firstString(links.homepage),
    explorerUrl: firstString(links.blockchain_site),
    whitepaperUrl: typeof links.whitepaper === "string" && links.whitepaper.length > 0 ? (links.whitepaper as string) : null,
    githubUrl: firstString(repos.github),
    twitterUrl: twitter ? `https://twitter.com/${twitter}` : null,
    redditUrl: typeof links.subreddit_url === "string" && (links.subreddit_url as string).length > 0 ? (links.subreddit_url as string) : null,
  };
}

export function parseMarketChart(raw: unknown): ChartPoint[] {
  const r = raw as { prices?: unknown };
  if (!Array.isArray(r.prices)) throw new Error("coingecko market_chart: missing prices array");
  return r.prices
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number")
    .map(([ts, value]) => ({ time: Math.floor(ts / 1000), value }));
}

export function parseTickers(raw: unknown): TickerRow[] {
  const r = raw as { tickers?: unknown };
  if (!Array.isArray(r.tickers)) return [];
  const out: TickerRow[] = [];
  for (const t of r.tickers) {
    const row = t as Record<string, unknown>;
    const market = row.market as Record<string, unknown> | undefined;
    const cl = row.converted_last as Record<string, unknown> | undefined;
    const cv = row.converted_volume as Record<string, unknown> | undefined;
    if (!market || typeof market.name !== "string") continue;
    if (typeof row.base !== "string" || typeof row.target !== "string") continue;
    const priceUsd = typeof cl?.usd === "number" ? cl.usd : null;
    const volumeUsd = typeof cv?.usd === "number" ? cv.usd : null;
    if (priceUsd === null || volumeUsd === null) continue;
    out.push({
      exchange: market.name,
      base: row.base,
      target: row.target,
      priceUsd,
      volumeUsd,
      tradeUrl: typeof row.trade_url === "string" ? row.trade_url : null,
    });
  }
  return out;
}

export async function fetchCoinDetail(id: string): Promise<CoinDetail> {
  const raw = await cgFetch(`/coins/${encodeURIComponent(id)}`, {
    localization: "false",
    tickers: "false",
    market_data: "false",
    community_data: "false",
    developer_data: "false",
    sparkline: "false",
  });
  return parseCoinDetail(raw);
}

export async function fetchMarketChart(id: string, days: number | "max"): Promise<ChartPoint[]> {
  const raw = await cgFetch(`/coins/${encodeURIComponent(id)}/market_chart`, {
    vs_currency: "usd",
    days: String(days),
  });
  return parseMarketChart(raw);
}

export async function fetchTickers(id: string): Promise<TickerRow[]> {
  const raw = await cgFetch(`/coins/${encodeURIComponent(id)}/tickers`, { page: "1" });
  return parseTickers(raw);
}
