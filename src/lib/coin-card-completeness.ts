export type CompletenessInput = {
  name?: string | null;
  symbol?: string | null;
  tagline?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  launchDate?: Date | string | null;
  tags?: string[] | null;
  links?: Record<string, unknown> | null;
  tokenomics?: Record<string, unknown> | null;
  security?: Record<string, unknown> | null;
  teamInfo?: Record<string, unknown> | null;
  marketing?: Record<string, unknown> | null;
  contracts?: unknown[] | null;
  markets?: unknown[] | null;
};

const MIN_DESCRIPTION = 120;
const MIN_PITCH = 80;

function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return true;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function sub(obj: Record<string, unknown> | null | undefined, key: string): unknown {
  return obj ? obj[key] : undefined;
}

/**
 * Weighted checklist driving the wizard progress bar. Weights sum to 100
 * exactly — asserted in the test rather than trusted by eye.
 */
const CHECKS: ReadonlyArray<{
  key: string;
  weight: number;
  test: (c: CompletenessInput) => boolean;
}> = [
  { key: "name", weight: 4, test: (c) => filled(c.name) },
  { key: "symbol", weight: 4, test: (c) => filled(c.symbol) },
  { key: "tagline", weight: 4, test: (c) => filled(c.tagline) },
  { key: "description", weight: 8, test: (c) => (c.description ?? "").trim().length >= MIN_DESCRIPTION },
  { key: "logoUrl", weight: 8, test: (c) => filled(c.logoUrl) },
  { key: "launchDate", weight: 3, test: (c) => filled(c.launchDate) },
  { key: "tags", weight: 3, test: (c) => filled(c.tags) },
  { key: "links.website", weight: 6, test: (c) => filled(sub(c.links, "website")) },
  { key: "links.docs", weight: 3, test: (c) => filled(sub(c.links, "docs")) },
  { key: "links.whitepaper", weight: 4, test: (c) => filled(sub(c.links, "whitepaper")) },
  { key: "links.github", weight: 4, test: (c) => filled(sub(c.links, "github")) },
  { key: "links.social", weight: 4, test: (c) => filled(sub(c.links, "x")) || filled(sub(c.links, "telegram")) },
  { key: "contracts", weight: 10, test: (c) => filled(c.contracts) },
  { key: "tokenomics.supply", weight: 6, test: (c) => filled(sub(c.tokenomics, "circulating")) || filled(sub(c.tokenomics, "total")) },
  { key: "tokenomics.method", weight: 4, test: (c) => filled(sub(c.tokenomics, "excludedAddresses")) || filled(sub(c.tokenomics, "emission")) },
  { key: "markets", weight: 6, test: (c) => filled(c.markets) },
  { key: "security.audits", weight: 6, test: (c) => filled(sub(c.security, "audits")) },
  { key: "security.entity", weight: 3, test: (c) => filled(sub(c.security, "legalEntity")) },
  { key: "teamInfo.members", weight: 5, test: (c) => filled(sub(c.teamInfo, "members")) },
  { key: "marketing.pitch", weight: 3, test: (c) => String(sub(c.marketing, "pitch") ?? "").trim().length >= MIN_PITCH },
  { key: "marketing.roadmap", weight: 2, test: (c) => filled(sub(c.marketing, "roadmap")) },
];

export const COMPLETENESS_TOTAL_WEIGHT = CHECKS.reduce((s, c) => s + c.weight, 0);

/** 0..100 — drives the wizard progress bar. */
export function computeCompleteness(card: CompletenessInput): number {
  const got = CHECKS.reduce((s, c) => (c.test(card) ? s + c.weight : s), 0);
  return Math.max(0, Math.min(100, Math.round((got / COMPLETENESS_TOTAL_WEIGHT) * 100)));
}

/** Keys of unmet checks, for the "what's still missing" hint. */
export function missingFields(card: CompletenessInput): string[] {
  return CHECKS.filter((c) => !c.test(card)).map((c) => c.key);
}
