/**
 * Способы оплаты помимо монет (слайс BY). Реестр в коде — как виды заведения (BN) и
 * лестница уровней (BD): три слова, которые должны одинаково называться в кабинете,
 * на витрине и в карточке с карты.
 *
 * Поле свободное: оно не меняет ни места, ни хозяина, ни принимаемых монет, фильтром
 * карты не служит, а неправда ловится жалобой (AQ). Монеты остаются модерируемыми —
 * их читает фид и по ним ищут.
 */

export const PAYMENT_METHODS = [
  { key: "cash", emoji: "💵" },
  { key: "card", emoji: "💳" },
  { key: "transfer", emoji: "🏦" },
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];

const KEYS = new Set<string>(PAYMENT_METHODS.map((m) => m.key));

/** Разбор набора из базы: неизвестный ключ выбрасывается, порядок — реестра. */
export function parsePaymentMethods(raw: unknown): PaymentMethodKey[] {
  if (!Array.isArray(raw)) return [];
  const have = new Set(raw.filter((v): v is string => typeof v === "string" && KEYS.has(v)));
  return PAYMENT_METHODS.filter((m) => have.has(m.key)).map((m) => m.key);
}

export function paymentMethod(key: string | null | undefined) {
  if (!key) return null;
  return PAYMENT_METHODS.find((m) => m.key === key) ?? null;
}
