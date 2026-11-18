import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Оценка монеты посетителем — целое от одной до пяти звёзд. Полузвёзд нет:
 * средняя считается нами, а отдельный голос должен читаться одним числом.
 */
export const MIN_STARS = 1;
export const MAX_STARS = 5;

/**
 * Ключ оценки — то, что стоит в адресе страницы монеты (`/coin/<coinKey>`).
 * У монеты рыночного фида это `Coin.id` (он же `Coin.slug` — в базе они равны
 * у всех строк), у монеты, живущей одной карточкой, — `CoinCard.slug`.
 * Проверка та же, что у закладки: иначе ключом можно было бы насыпать в
 * таблицу что угодно.
 */
export function isValidCoinKey(key: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(key);
}

/** Звёзды из внешнего мира: целое в пределах, всё прочее — не оценка. */
export function isValidStars(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_STARS &&
    value <= MAX_STARS
  );
}

export type RatingSummary = {
  /** Средняя оценка до десятой доли; `null` — не оценивал никто. */
  average: number | null;
  count: number;
  /** Оценка самого посетителя, если он её ставил. */
  mine: number | null;
};

/**
 * Среднее по голосам. Округление до десятой: вторая цифра после запятой у
 * двенадцати голосов означала бы точность, которой нет.
 */
export function summarizeRatings(
  stars: readonly number[],
  mine: number | null = null,
): RatingSummary {
  const valid = stars.filter((s) => isValidStars(s));
  if (valid.length === 0) return { average: null, count: 0, mine };
  const sum = valid.reduce((a, b) => a + b, 0);
  return {
    average: Math.round((sum / valid.length) * 10) / 10,
    count: valid.length,
    mine,
  };
}

/**
 * Сколько звёзд закрасить в неинтерактивном показе средней: половинок у нас
 * нет, поэтому закрашивается ближайшее целое. 4,5 закрашивается пятой звездой,
 * а само число стоит рядом цифрами — оно и есть точный ответ.
 */
export function filledStars(average: number | null): number {
  if (average == null) return 0;
  return Math.min(MAX_STARS, Math.max(0, Math.round(average)));
}

/** Оценки одной монеты вместе с оценкой самого посетителя. */
export async function readRatingSummary(coinKey: string): Promise<RatingSummary> {
  if (!isValidCoinKey(coinKey)) return { average: null, count: 0, mine: null };
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const rows = await prisma.coinRating.findMany({
    where: { coinKey },
    select: { stars: true, userId: true },
  });
  const mine = userId ? rows.find((r) => r.userId === userId)?.stars ?? null : null;
  return summarizeRatings(
    rows.map((r) => r.stars),
    mine,
  );
}
