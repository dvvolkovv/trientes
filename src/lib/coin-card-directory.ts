import { prisma } from "@/lib/prisma";

export type SelfListedCard = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  tagline: string | null;
  logoUrl: string | null;
  trust: string;
  completeness: number;
};

/**
 * Approved cards that are not bound to a CoinGecko-backed Coin. They carry no
 * price or market cap (that is slice C), so they cannot sit in the ranked
 * table — they get their own section instead of a row with empty columns.
 */
export async function listSelfListedCards(limit = 24): Promise<SelfListedCard[]> {
  return prisma.coinCard.findMany({
    where: { status: "APPROVED", coinId: null },
    orderBy: [{ trust: "desc" }, { completeness: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true, slug: true, name: true, symbol: true,
      tagline: true, logoUrl: true, trust: true, completeness: true,
    },
  });
}

/** Count for the listing tab badge — cheaper than loading the rows. */
export async function countSelfListedCards(): Promise<number> {
  return prisma.coinCard.count({ where: { status: "APPROVED", coinId: null } });
}
