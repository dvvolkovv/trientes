/**
 * Правила предложения продавца — чистые, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-19-product-offers-warehouses-design.md`, раздел 2.
 *
 * Предложение — это цена, единица, ставка кэшбэка и правила продажи **одного продавца**.
 * В паспорт товара они не кладутся: иначе второй продавец той же бутылки воды обязан
 * завести второй паспорт, и карточка мира распадается на карточки магазинов.
 */
import { CURRENCIES } from "@/lib/currency";
import { safeHttpUrl } from "@/lib/safe-url";

/**
 * Валюта цены — фиатная часть того же списка, что сайт уже умеет показывать. Второй
 * список валют в проекте разошёлся бы с первым (болезнь, которой уже болел список
 * локалей). Монеты из списка цен исключены сознательно: цену продажи задаёт фиат, а
 * монету выбирает покупатель при оплате — и курс там берёт эквайринг, не наше табло.
 */
const CRYPTO_CURRENCIES = new Set(["BTC", "ETH", "DASH"]);
export const OFFER_CURRENCIES = CURRENCIES.filter((c) => !CRYPTO_CURRENCIES.has(c));
export type OfferCurrency = (typeof OFFER_CURRENCIES)[number];

/** Единица измерения — свойство продавца: один продаёт колбасу килограммами, другой палками. */
export const OFFER_UNITS = ["pcs", "pack", "set", "kg", "g", "l", "ml", "m", "m2", "hour", "service"] as const;
export type OfferUnit = (typeof OFFER_UNITS)[number];

/**
 * Единицы, которые работа, а не товар. Такая строка полки не требует и с полки не
 * списывается (правило кассы CK), поэтому и наличие у неё не считается остатком:
 * занятие по записи «кончиться на складе» не может. Правило одно на кассу и на
 * витрину — вторая копия разошлась бы с первой.
 */
const SERVICE_UNITS = new Set(["service", "hour"]);

export function isServiceUnit(unit: string): boolean {
  return SERVICE_UNITS.has(unit);
}

/** Ставка ниже — это не кэшбэк, выше — почти наверняка набрали 500 вместо 5,00. */
export const CASHBACK_MIN = 0.1;
export const CASHBACK_MAX = 50;

export const MAX_SALE_RULES = 2000;

/**
 * Цена с клавиатуры телефона: запятая и точка значат одно и то же. Больше двух знаков
 * после запятой — не цена, а опечатка: валюты с тремя знаками у нас в списке нет.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

export type OfferInput = {
  price: string;
  currency: string;
  unit: string;
  cashbackPercent: string;
  onlineUrl: string | null;
  saleRules: string | null;
};

export type OfferValue = {
  price: number;
  currency: string;
  unit: string;
  cashbackPercent: number | null;
  onlineUrl: string | null;
  saleRules: string | null;
};

export type OfferReason = "price_invalid" | "currency_invalid" | "unit_invalid" | "cashback_invalid" | "url_invalid";

export function validateOffer(input: OfferInput): { ok: true; value: OfferValue } | { ok: false; reason: OfferReason } {
  const price = parseAmount(input.price);
  if (price === null) return { ok: false, reason: "price_invalid" };
  if (!(OFFER_CURRENCIES as readonly string[]).includes(input.currency)) {
    return { ok: false, reason: "currency_invalid" };
  }
  if (!(OFFER_UNITS as readonly string[]).includes(input.unit)) return { ok: false, reason: "unit_invalid" };

  // Ставки может не быть вовсе: не каждый продавец её обещает, и ноль здесь значит «нет».
  const raw = input.cashbackPercent.trim();
  let cashbackPercent: number | null = null;
  if (raw) {
    const parsed = parseAmount(raw);
    if (parsed === null || parsed < CASHBACK_MIN || parsed > CASHBACK_MAX) {
      return { ok: false, reason: "cashback_invalid" };
    }
    cashbackPercent = parsed;
  }

  const onlineRaw = (input.onlineUrl ?? "").trim();
  const onlineUrl = onlineRaw ? safeHttpUrl(onlineRaw) : null;
  if (onlineRaw && !onlineUrl) return { ok: false, reason: "url_invalid" };

  const rules = (input.saleRules ?? "").trim();
  return {
    ok: true,
    value: {
      price,
      currency: input.currency,
      unit: input.unit,
      cashbackPercent,
      onlineUrl,
      saleRules: rules ? rules.slice(0, MAX_SALE_RULES) : null,
    },
  };
}

/**
 * Предложение видно снаружи, когда живы все три: само предложение, предприятие и
 * паспорт. Своей модерации у предложения нет — его публикует уже залистованное
 * предприятие, а снимают те надзоры, которые в проекте уже есть.
 */
export function offerVisible(
  offer: { status: "ACTIVE" | "PAUSED" },
  company: { status: "PENDING" | "APPROVED" | "REJECTED"; suspendedAt: Date | null; deletedAt: Date | null },
  product: { suspendedAt: Date | null; deletedAt: Date | null; mergedIntoId: string | null },
): boolean {
  if (offer.status !== "ACTIVE") return false;
  if (company.status !== "APPROVED" || company.suspendedAt || company.deletedAt) return false;
  if (product.suspendedAt || product.deletedAt || product.mergedIntoId) return false;
  return true;
}

/**
 * Покупателю показывается наличие, а не число: точный остаток — коммерческая тайна
 * продавца и к тому же заявление, которого мы не проверяли. Отрицательный остаток
 * «в наличии» не значит — это разбор, а не товар на полке.
 */
export function availabilityOf(balances: readonly { qty: number }[]): boolean {
  return balances.some((b) => b.qty > 0);
}
