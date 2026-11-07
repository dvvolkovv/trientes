"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { canEditSection } from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import { syncCardMarkets, type MarketSyncStats } from "@/lib/coin-card-markets";

export type RefreshMarketsResult =
  | { ok: true; stats: MarketSyncStats }
  | { ok: false; reason: string };

/** Ручное обновление не чаще раза в 10 минут на карточку. */
export const REFRESH_WINDOW_MS = 10 * 60 * 1000;

/**
 * «Обновить рынки» из кабинета карточки. Воркер проходит каждые 10 минут, но
 * проект, который только что добавил листинг, не должен ждать прогона. Окно в
 * 10 минут нужно, чтобы кнопка не превратилась в бесплатный прокси к биржам;
 * снимки тикеров всё равно берутся из кеша Redis.
 */
export async function refreshCardMarkets(cardId: string): Promise<RefreshMarketsResult> {
  const { card, member } = await getViewerCard(cardId);
  if (!card) return { ok: false, reason: "card_not_found" };
  if (!canEditSection(member, "MARKETS")) return { ok: false, reason: "forbidden" };

  const markets = await prisma.coinCardMarket.findMany({
    where: { cardId },
    select: { checkedAt: true },
    orderBy: [{ checkedAt: "desc" }],
    take: 1,
  });
  if (markets.length === 0) return { ok: false, reason: "no_markets" };

  const last = markets[0].checkedAt;
  if (last && Date.now() - last.getTime() < REFRESH_WINDOW_MS) {
    return { ok: false, reason: "too_soon" };
  }

  const stats = await syncCardMarkets({
    prisma: prisma as never,
    redis: redis as never,
    cardId,
  });
  revalidatePath("/", "layout");
  return { ok: true, stats };
}
