"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canEditSection } from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import { syncCardSupply, type SupplySyncStats } from "@/lib/coin-card-supply";

export type SupplyRecheckResult =
  | { ok: true; stats: SupplySyncStats }
  | { ok: false; reason: string };

/** Ручной пересчёт не чаще раза в 5 минут на карточку. */
export const SUPPLY_RECHECK_WINDOW_MS = 5 * 60 * 1000;

/**
 * «Пересчитать выпуск» из кабинета карточки. Воркер ходит раз в час, но проект,
 * который только что дописал адрес казны, не должен ждать следующего часа.
 * Окно в 5 минут нужно, чтобы кнопка не стала бесплатным прокси к публичному
 * RPC: за один прогон уходит до 21 вызова.
 */
export async function recheckCardSupply(cardId: string): Promise<SupplyRecheckResult> {
  const { card, member } = await getViewerCard(cardId);
  if (!card) return { ok: false, reason: "card_not_found" };
  if (!canEditSection(member, "TOKENOMICS")) return { ok: false, reason: "forbidden" };

  // Нативная монета своей сети: контракта у неё нет, сверять нечего — цепь
  // отвечает сама за себя (слайс S).
  if (!card.nativeChain) {
    const canonical = card.contracts.find((c) => c.isCanonical);
    if (!canonical) return { ok: false, reason: "no_canonical_contract" };
    // Без сверки слайса B `totalSupply()` ничего не стоит: подделка с тем же
    // тикером ответит на него что угодно.
    if (!canonical.verifiedAt) return { ok: false, reason: "contract_unverified" };
  }

  const last = await prisma.coinCardSupply.findUnique({
    where: { cardId },
    select: { checkedAt: true },
  });
  if (last && Date.now() - last.checkedAt.getTime() < SUPPLY_RECHECK_WINDOW_MS) {
    return { ok: false, reason: "too_soon" };
  }

  const stats = await syncCardSupply({ prisma: prisma as never, cardId, limit: 1 });
  revalidatePath("/", "layout");
  return { ok: true, stats };
}
