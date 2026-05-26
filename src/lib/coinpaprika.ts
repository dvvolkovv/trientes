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

export type CoinPaprikaExchangeDetail = CoinPaprikaExchange & { pairsCount: number };

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
  const pairsCount = Array.isArray(json.markets) ? json.markets.length : 0;
  return { ...base, pairsCount };
}
