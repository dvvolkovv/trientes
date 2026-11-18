import { slugify, slugCandidates } from "@/lib/slugify";

/** URL-safe slug from a free-form coin name. Never empty. */
export function slugifyCoinName(input: string): string {
  return slugify(input, "coin");
}

/**
 * Slug candidates in preference order. The caller tries them against the
 * unique index and takes the first one that is free.
 */
export function buildSlugCandidates(name: string, symbol: string): string[] {
  const base = slugifyCoinName(name);
  const sym = slugifyCoinName(symbol);
  const out = [base];
  const withSym = `${base}-${sym}`;
  if (sym && withSym !== base && !base.endsWith(`-${sym}`) && base !== sym) {
    out.push(withSym);
  }
  for (const candidate of slugCandidates(base, 5 + out.length)) {
    if (out.length >= 5) break;
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}
