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
