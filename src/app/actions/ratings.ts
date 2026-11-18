"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  isValidCoinKey,
  isValidStars,
  summarizeRatings,
  type RatingSummary,
} from "@/lib/ratings";

type Result = { ok: true; summary: RatingSummary } | { ok: false; reason: string };

/**
 * Оценка монеты посетителем. Одна оценка на человека: повторное нажатие на
 * другую звезду меняет её, нажатие на свою же — снимает (оценку, которую
 * передумали ставить, надо уметь забрать, иначе средняя навсегда держит
 * случайный промах пальцем).
 *
 * Монета проверяется на существование: ключ приходит от клиента, и без
 * проверки в таблицу можно было бы насыпать оценок несуществующим монетам.
 * Годится и строка `Coin`, и опубликованная карточка — у монеты, живущей одной
 * карточкой, строки `Coin` нет по замыслу.
 */
export async function rateCoin(coinKey: string, stars: number): Promise<Result> {
  if (!isValidCoinKey(coinKey)) return { ok: false, reason: "invalid_key" };
  if (!isValidStars(stars)) return { ok: false, reason: "invalid_stars" };

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const [coin, card] = await Promise.all([
    prisma.coin.findFirst({
      where: { OR: [{ id: coinKey }, { slug: coinKey }] },
      select: { id: true },
    }),
    prisma.coinCard.findFirst({
      where: { slug: coinKey, status: "APPROVED" },
      select: { id: true },
    }),
  ]);
  if (!coin && !card) return { ok: false, reason: "not_found" };

  const existing = await prisma.coinRating.findUnique({
    where: { userId_coinKey: { userId, coinKey } },
    select: { stars: true },
  });
  if (existing?.stars === stars) {
    await prisma.coinRating.delete({ where: { userId_coinKey: { userId, coinKey } } });
  } else {
    await prisma.coinRating.upsert({
      where: { userId_coinKey: { userId, coinKey } },
      update: { stars },
      create: { userId, coinKey, stars },
    });
  }

  const rows = await prisma.coinRating.findMany({
    where: { coinKey },
    select: { stars: true, userId: true },
  });
  const summary = summarizeRatings(
    rows.map((r) => r.stars),
    rows.find((r) => r.userId === userId)?.stars ?? null,
  );
  revalidatePath(`/[locale]/coin/[slug]`, "page");
  return { ok: true, summary };
}
