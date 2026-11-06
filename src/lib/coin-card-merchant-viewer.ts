// Database-backed половина кнопки «я принимаю эту монету». Отделена от
// coin-card-merchant-cta.ts по тому же принципу, что coin-card-viewer.ts от
// coin-card-access.ts: чистые ссылки остаются тестируемыми.

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { MerchantCta } from "@/lib/coin-card-merchant-cta";

/**
 * Запросная часть. Без кеша — состояние зависит от сессии, а число точек
 * должно обновляться сразу после одобрения модератором.
 */
export async function getMerchantCta(cardId: string): Promise<MerchantCta> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { kind: "login" };

  // Права на точки даёт членство, а не Company.ownerUserId (командные аккаунты).
  const membership = await prisma.companyMember.findFirst({
    where: { userId, role: { in: ["OWNER", "EDITOR"] } },
    orderBy: { createdAt: "asc" },
    select: { companyId: true },
  });
  if (!membership) return { kind: "register_company" };

  const points = await prisma.companyPoint.count({
    where: { companyId: membership.companyId, acceptedCardIds: { has: cardId } },
  });
  if (points > 0) return { kind: "already", companyId: membership.companyId, points };
  return { kind: "add_point", companyId: membership.companyId };
}
