/**
 * Ставки кэшбэка — чистые правила, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-19-loyalty-rates-levels-design.md`, раздел 3.
 *
 * Продавец задаёт ставку в трёх местах: на товар (`ProductOffer.cashbackPercent`, BC), по
 * категории (`CashbackRule`) и на всё (`Company.cashbackBasePercent`). Действующая
 * считается здесь — одной функцией, чтобы паспорт товара, витрина предприятия и кабинет
 * показывали одно число.
 */
import { CASHBACK_MAX, CASHBACK_MIN, parseAmount } from "@/lib/products/offers-rules";

export type CashbackSource = "offer" | "category" | "company";

export type EffectiveCashback = { percent: number; source: CashbackSource };

/**
 * Пустая строка значит «ставки нет» и снимает её. Ноль сюда не проходит (`CASHBACK_MIN`):
 * «кэшбэк 0 %» — обещание, которого никто не давал, а отсутствие ставки это отсутствие
 * обещания. Пределы берутся из правил предложения: второй список разошёлся бы с первым.
 */
export function parseRate(
  raw: string,
): { ok: true; value: number | null } | { ok: false; reason: "cashback_invalid" } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  const parsed = parseAmount(text);
  if (parsed === null || parsed < CASHBACK_MIN || parsed > CASHBACK_MAX) {
    return { ok: false, reason: "cashback_invalid" };
  }
  return { ok: true, value: parsed };
}

/**
 * Побеждает ближайшая к товару ставка, а не наибольшая. Максимум выглядит выгоднее для
 * покупателя, но тогда продавец не может **понизить** ставку на отдельный товар: его же
 * общая ставка встала бы сверху. Источник возвращается затем, что в кабинете надо
 * объяснить, почему на экране покупателя стоит не то, что вписано в форму товара.
 */
export function effectiveCashback(input: {
  offer: number | null;
  category: number | null;
  company: number | null;
}): EffectiveCashback | null {
  if (input.offer !== null) return { percent: input.offer, source: "offer" };
  if (input.category !== null) return { percent: input.category, source: "category" };
  if (input.company !== null) return { percent: input.company, source: "company" };
  return null;
}

/**
 * Строка лояльности на витрине предприятия: «3 % на всё, до 7 % по категориям».
 * «До» не пишется, когда лучшая категория не лучше базы — обещать «до 5 %» при базе 5 %
 * значит говорить одно и то же дважды.
 */
export function cashbackSummary(input: {
  base: number | null;
  categories: readonly number[];
}): { base: number | null; max: number | null } | null {
  const best = input.categories.length > 0 ? Math.max(...input.categories) : null;
  const max = best !== null && (input.base === null || best > input.base) ? best : null;
  if (input.base === null && max === null) return null;
  return { base: input.base, max };
}
