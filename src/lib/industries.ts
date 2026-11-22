/**
 * Отрасль предприятия (слайс BU) — **вторая ось**, а не расширение видов
 * заведения.
 *
 * Расширять `MERCHANT_CATEGORIES` строительством и нефтепереработкой нельзя: у
 * каждого значения там висит интерес маршрута (BK) и цвет середины булавки (AY).
 * «Нефтепереработка» как интерес маршрута не значит ничего — мимо завода по пути
 * не заезжают, — а булавку она покрасила бы в цвет магазина.
 *
 * Поэтому оси две, и каждая отвечает на свой вопрос:
 *   вид заведения (`Company.category`) — «что это за место», работает на карте;
 *   отрасль (`Company.industry`)       — «чем предприятие занимается», работает
 *                                        в каталоге и поиске.
 *
 * Реестр живёт в коде — тот же приём, что лист проверок AP, лестница BD и ось
 * интересов BK: отрасль обязана значить одно и то же у всех предприятий, а для
 * этого список должен быть один, а не свой у каждого.
 */

export type Industry = {
  key: string;
  /** Знак для плитки: отрасль узнаётся глазом быстрее, чем читается. */
  emoji: string;
};

export const INDUSTRIES: Industry[] = [
  { key: "retail", emoji: "🛍️" },
  { key: "wholesale", emoji: "📦" },
  { key: "food", emoji: "🍽️" },
  { key: "hospitality", emoji: "🏨" },
  { key: "construction", emoji: "🏗️" },
  { key: "realEstate", emoji: "🏢" },
  { key: "oilGas", emoji: "🛢️" },
  { key: "energy", emoji: "⚡" },
  { key: "mining", emoji: "⛏️" },
  { key: "chemicals", emoji: "🧪" },
  { key: "manufacturing", emoji: "🏭" },
  { key: "agriculture", emoji: "🌾" },
  { key: "foodProduction", emoji: "🥫" },
  { key: "transport", emoji: "🚚" },
  { key: "automotive", emoji: "🚗" },
  { key: "it", emoji: "💻" },
  { key: "telecom", emoji: "📡" },
  { key: "finance", emoji: "🏦" },
  { key: "crypto", emoji: "🪙" },
  { key: "legal", emoji: "⚖️" },
  { key: "education", emoji: "🎓" },
  { key: "health", emoji: "🩺" },
  { key: "media", emoji: "📣" },
  { key: "other", emoji: "🧩" },
];

export const INDUSTRY_KEYS = INDUSTRIES.map((i) => i.key);

/**
 * Своя рубрика — слово продавца о себе, и предел у неё жёсткий: это подпись, а не
 * описание (описание у предприятия своё, и оно длинное).
 */
export const INDUSTRY_CUSTOM_MAX = 40;

export function isIndustry(key: string | null | undefined): boolean {
  if (!key) return false;
  return INDUSTRY_KEYS.includes(key);
}

export function industry(key: string | null | undefined): Industry | null {
  if (!key) return null;
  return INDUSTRIES.find((i) => i.key === key) ?? null;
}
