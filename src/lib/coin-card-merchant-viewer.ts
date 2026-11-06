// Database-backed половина кнопки «я принимаю эту монету». Отделена от
// coin-card-merchant-cta.ts по тому же принципу, что coin-card-viewer.ts от
// coin-card-access.ts: чистые ссылки остаются тестируемыми.

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  pickMerchantCompanies,
  type MerchantCompany,
  type MerchantCta,
} from "@/lib/coin-card-merchant-cta";
import { NOT_DELETED } from "@/lib/soft-delete";

/**
 * Без кеша — состояние зависит от сессии, а число точек должно обновляться
 * сразу после одобрения модератором.
 */
export async function getMerchantCta(cardId: string): Promise<MerchantCta> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { kind: "login" };

  // Права на точки даёт членство, а не Company.ownerUserId (командные аккаунты).
  const memberships = await prisma.companyMember.findMany({
    where: { userId, role: { in: ["OWNER", "EDITOR"] }, company: NOT_DELETED },
    orderBy: { createdAt: "asc" },
    select: { company: { select: { id: true, displayName: true, status: true } } },
  });
  if (memberships.length === 0) return { kind: "register_company" };

  const companyIds = memberships.map((m) => m.company.id);
  // Одним запросом: сколько точек каждой компании уже принимают эту карточку.
  const grouped = await prisma.companyPoint.groupBy({
    by: ["companyId"],
    where: { companyId: { in: companyIds }, acceptedCardIds: { has: cardId }, ...NOT_DELETED },
    _count: { _all: true },
  });
  const byCompany = new Map(grouped.map((g) => [g.companyId, g._count._all]));

  const rows: MerchantCompany[] = memberships.map((m) => ({
    id: m.company.id,
    displayName: m.company.displayName,
    status: m.company.status,
    acceptedPoints: byCompany.get(m.company.id) ?? 0,
  }));
  return { kind: "choose", ...pickMerchantCompanies(rows) };
}
