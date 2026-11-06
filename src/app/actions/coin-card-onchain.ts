"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canEditSection } from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import { verifyCardContracts, type VerifyStats } from "@/lib/coin-card-onchain";

export type RecheckResult = { ok: true; stats: VerifyStats } | { ok: false; reason: string };

/** Ручная сверка не чаще раза в 10 минут на карточку. */
export const RECHECK_WINDOW_MS = 10 * 60 * 1000;

/**
 * «Сверить сейчас» из кабинета карточки. Воркер и так ходит раз в сутки, но
 * проект, который только что исправил адрес, не должен ждать до утра.
 * Окно в 10 минут нужно, чтобы кнопка не превратилась в бесплатный прокси
 * к публичному RPC.
 */
export async function recheckCardContracts(cardId: string): Promise<RecheckResult> {
  const { card, member } = await getViewerCard(cardId);
  if (!card) return { ok: false, reason: "card_not_found" };
  if (!canEditSection(member, "CONTRACTS")) return { ok: false, reason: "forbidden" };

  const contracts = await prisma.coinCardContract.findMany({
    where: { cardId },
    select: { checkedAt: true },
    orderBy: [{ checkedAt: "desc" }],
    take: 1,
  });
  if (contracts.length === 0) return { ok: false, reason: "no_contracts" };

  const last = contracts[0].checkedAt;
  if (last && Date.now() - last.getTime() < RECHECK_WINDOW_MS) {
    return { ok: false, reason: "too_soon" };
  }

  const stats = await verifyCardContracts({ prisma: prisma as never, cardId, limit: 20 });
  revalidatePath("/", "layout");
  return { ok: true, stats };
}
