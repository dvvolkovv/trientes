const MAX_SLUG = 60;

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * URL-safe slug из свободного имени. Никогда не пустой: `fallback` — слово вызывающего
 * (у монеты это "coin", у товара "product"), потому что имя бывает целиком из знаков,
 * которые в адрес не идут — иероглифы, кавычки, одни точки.
 */
export function slugify(input: string, fallback = "item"): string {
  const lowered = (input ?? "").toLowerCase();
  let out = "";
  for (const ch of lowered) {
    if (ch in CYR) out += CYR[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!out) return fallback;
  if (out.length > MAX_SLUG) out = out.slice(0, MAX_SLUG).replace(/-+$/g, "");
  return out || fallback;
}

/** Кандидаты слага по убыванию желанности: вызывающий берёт первый свободный. */
export function slugCandidates(base: string, count = 5): string[] {
  const out = [base];
  for (let n = 2; out.length < count; n += 1) out.push(`${base}-${n}`);
  return out;
}
