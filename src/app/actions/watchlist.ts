"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function toggleWatchlist(coinId: string): Promise<{ ok: boolean; watched?: boolean; reason?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(coinId)) {
    return { ok: false, reason: "invalid_id" };
  }
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  // Confirm the coin exists.
  const coin = await prisma.coin.findUnique({ where: { id: coinId }, select: { id: true } });
  if (!coin) return { ok: false, reason: "not_found" };

  const existing = await prisma.watchlist.findUnique({
    where: { userId_coinId: { userId, coinId } },
  });
  if (existing) {
    await prisma.watchlist.delete({
      where: { userId_coinId: { userId, coinId } },
    });
    revalidatePath("/", "layout");
    return { ok: true, watched: false };
  }
  await prisma.watchlist.create({ data: { userId, coinId } });
  revalidatePath("/", "layout");
  return { ok: true, watched: true };
}

export async function toggleExchangeWatchlist(
  exchangeId: string,
): Promise<{ ok: boolean; watched?: boolean; reason?: string }> {
  // CoinGecko exchange ids are lowercase alphanumerics with hyphens/underscores.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(exchangeId)) {
    return { ok: false, reason: "invalid_id" };
  }
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const exchange = await prisma.exchange.findUnique({
    where: { id: exchangeId },
    select: { id: true },
  });
  if (!exchange) return { ok: false, reason: "not_found" };

  const existing = await prisma.exchangeWatchlist.findUnique({
    where: { userId_exchangeId: { userId, exchangeId } },
  });
  if (existing) {
    await prisma.exchangeWatchlist.delete({
      where: { userId_exchangeId: { userId, exchangeId } },
    });
    revalidatePath("/", "layout");
    return { ok: true, watched: false };
  }
  await prisma.exchangeWatchlist.create({ data: { userId, exchangeId } });
  revalidatePath("/", "layout");
  return { ok: true, watched: true };
}

/**
 * Закладка на монету, которая живёт одной карточкой. Отдельное действие, а не
 * ветка в `toggleWatchlist`: там `coinId` — внешний ключ на `Coin`, а у такой
 * монеты строки `Coin` нет, и закладка ложится в свою таблицу (`CardWatchlist`).
 */
export async function toggleCardWatchlist(
  cardSlug: string,
): Promise<{ ok: boolean; watched?: boolean; reason?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(cardSlug)) {
    return { ok: false, reason: "invalid_id" };
  }
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  // Закладка только на опубликованную карточку: ожидающая решения публике не
  // показана вовсе.
  const card = await prisma.coinCard.findFirst({
    where: { slug: cardSlug, status: "APPROVED" },
    select: { slug: true },
  });
  if (!card) return { ok: false, reason: "not_found" };

  const existing = await prisma.cardWatchlist.findUnique({
    where: { userId_cardSlug: { userId, cardSlug } },
  });
  if (existing) {
    await prisma.cardWatchlist.delete({
      where: { userId_cardSlug: { userId, cardSlug } },
    });
    revalidatePath("/", "layout");
    return { ok: true, watched: false };
  }
  await prisma.cardWatchlist.create({ data: { userId, cardSlug } });
  revalidatePath("/", "layout");
  return { ok: true, watched: true };
}
