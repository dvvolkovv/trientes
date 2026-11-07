import { prisma } from "@/lib/prisma";

/** Only APPROVED cards are ever public. */
export async function getPublicCoinCard(slug: string) {
  return prisma.coinCard.findFirst({
    where: { slug, status: "APPROVED" },
    include: {
      contracts: { orderBy: [{ isCanonical: "desc" }, { chain: "asc" }] },
      markets: { orderBy: { volumeUsd24h: "desc" }, take: 100 },
      // Слайс C: наш собственный индекс цены по подтверждённым рынкам.
      priceIndex: true,
      // Слайс E: циркулирующий выпуск, посчитанный из сети.
      supply: true,
    },
  });
}

export type PublicCoinCard = NonNullable<Awaited<ReturnType<typeof getPublicCoinCard>>>;
