const MAX_SLUG = 60;

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** URL-safe slug from a free-form coin name. Never empty. */
export function slugifyCoinName(input: string): string {
  const lowered = (input ?? "").toLowerCase();
  let out = "";
  for (const ch of lowered) {
    if (ch in CYR) out += CYR[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!out) return "coin";
  if (out.length > MAX_SLUG) out = out.slice(0, MAX_SLUG).replace(/-+$/g, "");
  return out || "coin";
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
  for (let n = 2; out.length < 5; n += 1) out.push(`${base}-${n}`);
  return out;
}
