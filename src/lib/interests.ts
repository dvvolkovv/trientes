/**
 * Интересы человека (ТЗ 4.4) — ось из пяти ключей, одна на всю сеть и заданная в коде.
 * Тот же приём, что лист проверок в AP и лестница уровней в BD: человек, назвавший свои
 * интересы, обязан находить их у любой точки любого источника, а для этого ось должна
 * быть одна, а не своя у каждого слоя.
 *
 * Спека: `docs/superpowers/specs/2026-11-20-route-interests-stops-design.md`.
 */
import type { PoiLayer } from "@/lib/crypto-map";

export const INTEREST_KEYS = ["fuel", "food", "lodging", "shop", "cash"] as const;

export type InterestKey = (typeof INTEREST_KEYS)[number];

export type InterestVerdictValue = "LIKE" | "DISLIKE";

export type InterestMark = { key: string; verdict: InterestVerdictValue };

/**
 * Правила опознания. Категория в зеркале BTC Map приходит свободным текстом из тегов
 * OSM (сотни значений), поэтому опознаём словами, а не перечнем: `Fast Food`,
 * `Fast_food` и `Food Court` — одно и то же место.
 */
const RULES: { key: InterestKey; re: RegExp }[] = [
  { key: "fuel", re: /\b(fuel|petrol|gas station|charging|charge point|ev charg)/i },
  { key: "food", re: /\b(restaurant|cafe|coffee|fast food|food|bar|pub|bakery|pizza|bistro|canteen|ice cream)/i },
  { key: "lodging", re: /\b(hotel|hostel|guest house|guesthouse|motel|apartment|camp site|campsite|chalet|resort)/i },
];

/** Слои, которые целиком означают «наличные и обмен». */
const CASH_LAYERS: PoiLayer[] = ["atm", "financial", "fintech"];

/**
 * К какому интересу относится точка. `shop` — **падающий остаток** слоя «магазин», а не
 * отдельное правило: место, не попавшее ни в одно правило, честнее показать магазином,
 * чем не показать вовсе. Возвращает `null` только у слоя, которого в оси нет.
 */
export function interestOf(poi: { layer: PoiLayer; category?: string | null }): InterestKey | null {
  if (CASH_LAYERS.includes(poi.layer)) return "cash";
  const category = poi.category ?? "";
  for (const rule of RULES) {
    if (rule.re.test(category)) return rule.key;
  }
  return poi.layer === "merchant" ? "shop" : null;
}

/**
 * Какие интересы показывать по пути.
 *
 * Отметок нет вовсе — все пять: молчание не значит «ничего не показывать», человек,
 * впервые строящий маршрут, ещё ничего о себе не сказал. Появился хоть один «нравится» —
 * набор сужается до названного. «Не нравится» вычитается всегда и сильнее «нравится»:
 * сказанное «нет» человек помнит лучше, чем давнее «да».
 */
export function activeInterests(marks: readonly InterestMark[]): InterestKey[] {
  const liked = new Set<string>();
  const disliked = new Set<string>();
  for (const m of marks) {
    if (m.verdict === "LIKE") liked.add(m.key);
    else disliked.add(m.key);
  }
  const base = liked.size > 0 ? INTEREST_KEYS.filter((k) => liked.has(k)) : [...INTEREST_KEYS];
  return base.filter((k) => !disliked.has(k));
}

/** Коридор: насколько далеко от линии место ещё считается «по пути». */
export const CORRIDOR_DEFAULT = 1500;
export const CORRIDOR_MIN = 200;
export const CORRIDOR_MAX = 10_000;

/** За сколько до отмеченной точки сказать. ТЗ называет «за 1–2 км» — берём середину. */
export const ALERT_DEFAULT = 1500;
export const ALERT_MIN = 500;
export const ALERT_MAX = 5000;

type Parsed<R extends string> = { ok: true; value: number } | { ok: false; reason: R };

function parseMeters<R extends string>(
  raw: string,
  fallback: number,
  min: number,
  max: number,
  reason: R,
): Parsed<R> {
  const text = raw.trim();
  // Пустое поле — умолчание, а не ноль: «коридор 0 м» означал бы, что по пути нет
  // ничего, и человек решил бы, что раздел не работает.
  if (!text) return { ok: true, value: fallback };
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, reason };
  const value = Math.round(n);
  if (value < min || value > max) return { ok: false, reason };
  return { ok: true, value };
}

export function parseCorridor(raw: string) {
  return parseMeters(raw, CORRIDOR_DEFAULT, CORRIDOR_MIN, CORRIDOR_MAX, "corridor_invalid" as const);
}

export function parseAlert(raw: string) {
  return parseMeters(raw, ALERT_DEFAULT, ALERT_MIN, ALERT_MAX, "alert_invalid" as const);
}
