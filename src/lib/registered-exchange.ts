import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function listViewerExchanges() {
  const userId = await viewerId();
  if (!userId) return [];
  return prisma.registeredExchange.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, legalName: true, status: true },
  });
}

export async function getViewerExchangeById(exchangeId: string) {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, exchange: null };
  const exchange = await prisma.registeredExchange.findUnique({ where: { id: exchangeId } });
  if (!exchange || exchange.ownerUserId !== userId) return { userId, exchange: null };
  return { userId, exchange };
}
