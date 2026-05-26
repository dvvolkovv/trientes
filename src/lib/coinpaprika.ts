import { z } from "zod";

/**
 * Normalized shape we use internally after parsing CoinPaprika's response.
 */
export type CoinPaprikaExchange = {
  id: string;
  name: string;
  type: string[];
  description: string | null;
  active: boolean;
  markets_data_fetched: boolean;
  adjusted_rank: number | null;
  currencies: number | null;
  fiats: { name: string; symbol: string }[];
  volume24hUsd: number;
  links: {
    twitter?: string[];
    telegram?: string[];
    facebook?: string[];
    github?: string[];
    reddit?: string[];
    youtube?: string[];
    website?: string[];
  };
};

const linksSchema = z.object({
  twitter: z.array(z.string()).optional(),
  telegram: z.array(z.string()).optional(),
  facebook: z.array(z.string()).optional(),
  github: z.array(z.string()).optional(),
  reddit: z.array(z.string()).optional(),
  youtube: z.array(z.string()).optional(),
  website: z.array(z.string()).optional(),
}).optional().default({});

const coinPaprikaExchangeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
  active: z.boolean().optional().default(false),
  markets_data_fetched: z.boolean().optional().default(false),
  adjusted_rank: z.number().nullable().optional(),
  currencies: z.number().nullable().optional(),
  fiats: z.array(z.object({ name: z.string(), symbol: z.string() })).optional().default([]),
  quotes: z.object({
    USD: z.object({ adjusted_volume_24h: z.number().nullable().optional() }).optional(),
  }).optional().default({}),
  links: linksSchema,
});

export function parseCoinPaprikaExchange(raw: unknown): CoinPaprikaExchange | null {
  const r = coinPaprikaExchangeSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    description: d.description?.trim() || null,
    active: d.active,
    markets_data_fetched: d.markets_data_fetched,
    adjusted_rank: d.adjusted_rank ?? null,
    currencies: d.currencies ?? null,
    fiats: d.fiats,
    volume24hUsd: d.quotes?.USD?.adjusted_volume_24h ?? 0,
    links: d.links,
  };
}

export function cpTypeToExchangeType(type: string[]): "CEX" | "DEX" | "HYBRID" | "OTHER" | null {
  if (type.length === 0) return null;
  const hasCex = type.some((t) => t === "cex" || t === "spot" || t === "perpetuals");
  const hasDex = type.includes("dex");
  if (hasCex && hasDex) return "HYBRID";
  if (hasCex) return "CEX";
  if (hasDex) return "DEX";
  return "OTHER";
}

/**
 * Known cases where CoinGecko and CoinPaprika use different slugs for the same exchange.
 * Add new entries here as overlap is discovered (CG list is the canonical id space).
 */
export const CP_TO_CG_ALIAS: Record<string, string> = {
  coinbase: "gdax",
};

export function resolveCpId(cpId: string): string {
  return CP_TO_CG_ALIAS[cpId] ?? cpId;
}

const CP_BASE = "https://api.coinpaprika.com/v1";

export async function fetchCoinPaprikaExchanges(): Promise<CoinPaprikaExchange[]> {
  const res = await fetch(`${CP_BASE}/exchanges`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`CoinPaprika /exchanges failed: ${res.status}`);
  const json = (await res.json()) as unknown[];
  if (!Array.isArray(json)) throw new Error("CoinPaprika /exchanges: expected array");
  const out: CoinPaprikaExchange[] = [];
  for (const row of json) {
    const parsed = parseCoinPaprikaExchange(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export type CoinPaprikaMarket = {
  pair: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseCurrencyId: string | null;
  quoteCurrencyId: string | null;
  category: string | null;
  priceUsd: number | null;
  volumeUsd24h: number | null;
  volumeSharePct: number | null;
  outlier: boolean;
  marketUrl: string | null;
  lastTradedAt: Date | null;
};

const cpMarketSchema = z.object({
  pair: z.string(),
  base_currency_id: z.string().nullable().optional(),
  base_currency_name: z.string().nullable().optional(),
  quote_currency_id: z.string().nullable().optional(),
  quote_currency_name: z.string().nullable().optional(),
  market_url: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  outlier: z.boolean().nullable().optional(),
  adjusted_volume_share: z.number().nullable().optional(),
  reported_volume_share: z.number().nullable().optional(),
  last_updated: z.string().nullable().optional(),
  quotes: z.record(z.string(), z.object({
    price: z.number().nullable().optional(),
    volume_24h: z.number().nullable().optional(),
  })).optional().default({}),
});

function parseSymbol(pair: string, side: "base" | "quote"): string {
  const sep = pair.indexOf("/");
  if (sep === -1) return side === "base" ? pair : "";
  return side === "base" ? pair.slice(0, sep) : pair.slice(sep + 1);
}

function normalizeCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes("perp")) return "perpetual";
  if (v.includes("fut")) return "futures";
  if (v.includes("spot")) return "spot";
  return v;
}

export function parseCoinPaprikaMarket(raw: unknown): CoinPaprikaMarket | null {
  const r = cpMarketSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  const usd = d.quotes?.USD ?? null;
  const ts = d.last_updated ? new Date(d.last_updated) : null;
  return {
    pair: d.pair,
    baseSymbol: parseSymbol(d.pair, "base"),
    quoteSymbol: parseSymbol(d.pair, "quote"),
    baseCurrencyId: d.base_currency_id ?? null,
    quoteCurrencyId: d.quote_currency_id ?? null,
    category: normalizeCategory(d.category),
    priceUsd: usd?.price ?? null,
    volumeUsd24h: usd?.volume_24h ?? null,
    volumeSharePct: d.adjusted_volume_share ?? d.reported_volume_share ?? null,
    outlier: d.outlier ?? false,
    marketUrl: d.market_url ?? null,
    lastTradedAt: ts && !isNaN(ts.getTime()) ? ts : null,
  };
}

export type CoinPaprikaExchangeDetail = CoinPaprikaExchange & {
  pairsCount: number;
  markets: CoinPaprikaMarket[];
};

/**
 * Detail call — only used for exchanges that survive the volume filter,
 * so we can derive pairsCount from markets[].length.
 */
export async function fetchCoinPaprikaExchangeDetail(id: string): Promise<CoinPaprikaExchangeDetail | null> {
  const res = await fetch(`${CP_BASE}/exchanges/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { markets?: unknown[] } & Record<string, unknown>;
  const base = parseCoinPaprikaExchange(json);
  if (!base) return null;
  const rawMarkets = Array.isArray(json.markets) ? json.markets : [];
  const markets: CoinPaprikaMarket[] = [];
  for (const m of rawMarkets) {
    const parsed = parseCoinPaprikaMarket(m);
    if (parsed && parsed.pair) markets.push(parsed);
  }
  return { ...base, pairsCount: rawMarkets.length, markets };
}
