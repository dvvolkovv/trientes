import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function readUserWatchedIds(): Promise<Set<string>> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return new Set();
  const rows = await prisma.watchlist.findMany({
    where: { userId },
    select: { coinId: true },
  });
  return new Set(rows.map((r) => r.coinId));
}

/**
 * Закладки на монеты, живущие одной карточкой. Свой набор, а не примесь к
 * `readUserWatchedIds`: ключи у них из разных пространств (`Coin.id` против
 * `CoinCard.slug`), и сложи их в один набор — закладка одной монеты могла бы
 * зажечь звёздочку другой.
 */
export async function readUserWatchedCardSlugs(): Promise<Set<string>> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return new Set();
  const rows = await prisma.cardWatchlist.findMany({
    where: { userId },
    select: { cardSlug: true },
  });
  return new Set(rows.map((r) => r.cardSlug));
}

export async function readUserWatchedExchangeIds(): Promise<Set<string>> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return new Set();
  const rows = await prisma.exchangeWatchlist.findMany({
    where: { userId },
    select: { exchangeId: true },
  });
  return new Set(rows.map((r) => r.exchangeId));
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await auth();
  return Boolean((session?.user as { id?: string } | undefined)?.id);
}
