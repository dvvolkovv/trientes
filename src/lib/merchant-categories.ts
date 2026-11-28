/**
 * Вид заведения (слайс BN, ТЗ § 3.1 — «категория» карточки магазина).
 *
 * В данных его не было вовсе: `CompanyPoint.type` знает `SHOP`, `ATM`, `POS`,
 * `SALES_OFFICE`, `COMPANY`, `ONLINE` — это **способ приёма**, а не род занятия.
 * Из-за этого слайс BK честно записал «своя точка, кроме банкомата, это магазин»:
 * наша заправка не находилась по интересу «топливо», а булавка пульсировала
 * зелёным, хотя AY уже умеет красить заправку синим — у точки зеркала BTC Map,
 * где род занятия приходит из тегов OSM.
 *
 * Реестр живёт в коде — тот же приём, что лист проверок в AP, лестница уровней в
 * BD и ось интересов в BK: вид обязан значить одно и то же у всех предприятий, а
 * для этого список должен быть один, а не свой у каждого.
 */

import type { InterestKey } from "@/lib/interests";

export type MerchantCategory = {
  key: string;
  /** Знак для плитки: вид заведения узнаётся глазом быстрее, чем читается. */
  emoji: string;
  /** К какому интересу маршрута относится вид (ось BK — одна на все источники). */
  interest: InterestKey;
};

/**
 * Перечень нарочно короткий. Длинный список (как в OSM — сотни значений `shop=*`)
 * мерчант не прочитает, а нам он нужен ровно для трёх дел: подпись на витрине,
 * цвет середины булавки и совпадение с интересом в маршруте.
 */
export const MERCHANT_CATEGORIES: MerchantCategory[] = [
  { key: "grocery", emoji: "🛒", interest: "shop" },
  { key: "cafe", emoji: "☕", interest: "food" },
  { key: "restaurant", emoji: "🍽️", interest: "food" },
  { key: "bar", emoji: "🍺", interest: "food" },
  { key: "fuel", emoji: "⛽", interest: "fuel" },
  { key: "charging", emoji: "🔌", interest: "fuel" },
  { key: "hotel", emoji: "🛏️", interest: "lodging" },
  { key: "clothing", emoji: "👕", interest: "shop" },
  { key: "electronics", emoji: "💻", interest: "shop" },
  { key: "pharmacy", emoji: "💊", interest: "shop" },
  { key: "beauty", emoji: "💅", interest: "shop" },
  // Велнес: студия йоги, пилатеса, медитации. Завести пришлось потому, что у такого
  // заведения из списка подходили только «услуги» (🔧) — на витрине это читалось как
  // мастерская. Интерес маршрута — `shop`: это место назначения, а не топливо, еда,
  // ночлег или наличные.
  { key: "wellness", emoji: "🧘", interest: "shop" },
  { key: "services", emoji: "🔧", interest: "shop" },
  { key: "exchange", emoji: "💱", interest: "cash" },
  { key: "atm", emoji: "🏧", interest: "cash" },
  { key: "other", emoji: "🏬", interest: "shop" },
];

export const MERCHANT_CATEGORY_KEYS = MERCHANT_CATEGORIES.map((c) => c.key);

export function isMerchantCategory(key: string | null | undefined): boolean {
  if (!key) return false;
  return MERCHANT_CATEGORY_KEYS.includes(key);
}

export function merchantCategory(key: string | null | undefined): MerchantCategory | null {
  if (!key) return null;
  return MERCHANT_CATEGORIES.find((c) => c.key === key) ?? null;
}

/** Интерес, к которому относится вид. Незнакомый ключ — это «не знаю», а не «магазин». */
export function categoryInterest(key: string | null | undefined): InterestKey | null {
  return merchantCategory(key)?.interest ?? null;
}

/**
 * Какой вид считать видом места: уточнение точки сильнее категории предприятия —
 * ровно как ставка кэшбэка в BD идёт товар → категория → предприятие. Сеть, у
 * которой при автомойке стоит кофейня, иначе обязана была бы завести второе
 * предприятие.
 */
export function effectiveCategory(
  pointCategory: string | null | undefined,
  companyCategory: string | null | undefined,
): string | null {
  if (isMerchantCategory(pointCategory)) return pointCategory!;
  if (isMerchantCategory(companyCategory)) return companyCategory!;
  return null;
}
