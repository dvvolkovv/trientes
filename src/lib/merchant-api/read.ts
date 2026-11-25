/**
 * Список ключей API предприятия (слайс CL). Отозванные остаются в списке: по журналу
 * должно читаться, какой ключ работал и почему его сняли.
 */
import { prisma } from "@/lib/prisma";

export async function readApiKeys(companyId: string) {
  return prisma.merchantApiKey.findMany({
    where: { companyId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    take: 30,
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
      revokeReason: true,
    },
  });
}
