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
  /** Слайс C: наш собственный индекс, если он уже посчитан. */
  priceUsd: number | null;
  change24h: number | null;
};

/**
 * Approved cards that are not bound to a CoinGecko-backed Coin. Capitalisation
 * still needs a verified circulating supply (slice E), so they keep their own
 * section rather than a row in the ranked table — but since slice C they do
 * carry a price: our own volume-weighted median across confirmed markets.
 */
export async function listSelfListedCards(limit = 24): Promise<SelfListedCard[]> {
  const rows = await prisma.coinCard.findMany({
    where: { status: "APPROVED", coinId: null },
    orderBy: [{ trust: "desc" }, { completeness: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true, slug: true, name: true, symbol: true,
      tagline: true, logoUrl: true, trust: true, completeness: true,
      priceIndex: { select: { priceUsd: true, change24h: true } },
    },
  });
  return rows.map(({ priceIndex, ...card }) => ({
    ...card,
    priceUsd: priceIndex?.priceUsd ?? null,
    change24h: priceIndex?.change24h ?? null,
  }));
}

/** Count for the listing tab badge — cheaper than loading the rows. */
export async function countSelfListedCards(): Promise<number> {
  return prisma.coinCard.count({ where: { status: "APPROVED", coinId: null } });
}
