import { prisma } from "@/lib/prisma";
import { LIVE_CARD_COMPANY } from "@/lib/company-visibility";

/**
 * Public только APPROVED — и только пока жива компания-владелец: снятое
 * надзором предприятие не должно оставаться на витрине своей карточкой
 * (`LIVE_CARD_COMPANY` пропускает посеянные нами карточки без компании).
 */
export async function getPublicCoinCard(slug: string) {
  return prisma.coinCard.findFirst({
    where: { slug, status: "APPROVED", ...LIVE_CARD_COMPANY },
    include: {
      contracts: { orderBy: [{ isCanonical: "desc" }, { chain: "asc" }] },
      markets: { orderBy: { volumeUsd24h: "desc" }, take: 100 },
      // Слайс C: наш собственный индекс цены по подтверждённым рынкам.
      priceIndex: true,
      // Слайс E: циркулирующий выпуск, посчитанный из сети.
      supply: true,
      // Слайс S: факты собственной сети нативной монеты.
      chainFacts: true,
    },
  });
}

export type PublicCoinCard = NonNullable<Awaited<ReturnType<typeof getPublicCoinCard>>>;
