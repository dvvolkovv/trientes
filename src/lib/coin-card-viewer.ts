// Database-backed lookups behind the card cabinet. Kept apart from
// coin-card-access.ts so the permission gates stay pure and unit-testable
// without dragging Auth.js and Prisma into the test run.

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { CardRole } from "@/lib/coin-card-access";
import type { CardSection } from "@/lib/coin-card-risk";

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/** Every card the viewer is a member of — the cabinet list. */
export async function listViewerCards() {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, cards: [] };
  const cards = await prisma.coinCard.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, slug: true, name: true, symbol: true, logoUrl: true,
      status: true, trust: true, completeness: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  return { userId, cards };
}

function loadCardForMember(cardId: string) {
  return prisma.coinCard.findUnique({
    where: { id: cardId },
    include: {
      contracts: { orderBy: [{ isCanonical: "desc" }, { chain: "asc" }] },
      markets: { orderBy: { exchangeName: "asc" } },
      policy: true,
    },
  });
}

export type ViewerMember = {
  id: string;
  role: CardRole;
  sections: CardSection[];
  isSigner: boolean;
};

export type ViewerCardResult = {
  userId: string | null;
  card: Awaited<ReturnType<typeof loadCardForMember>>;
  member: ViewerMember | null;
};

/** The card plus the viewer's membership, or nulls. Mirrors getViewerCompanyById. */
export async function getViewerCard(cardId: string): Promise<ViewerCardResult> {
  const userId = await viewerId();
  if (!userId) return { userId: null, card: null, member: null };
  const [card, member] = await Promise.all([
    loadCardForMember(cardId),
    prisma.coinCardMember.findUnique({
      where: { cardId_userId: { cardId, userId } },
      select: { id: true, role: true, sections: true, isSigner: true },
    }),
  ]);
  if (!card || !member) return { userId, card: null, member: null };
  return { userId, card, member };
}
