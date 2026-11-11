import { prisma } from "@/lib/prisma";
import { collectCardProse } from "@/lib/coin-card-prose";
import { localizedProse } from "@/lib/localized-prose";

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
 *
 * Подпись карточки — проза проекта, и в витрине она должна быть на языке
 * интерфейса, как на самой карточке: иначе хорват читает русскую строку рядом
 * с хорватской плашкой. Переводим из кеша и только из него (`cacheOnly`) —
 * ключ тот же, что у страницы карточки, поэтому набор полей здесь полный, а не
 * одна подпись: другой набор дал бы другой хеш и промах мимо прогретого кеша.
 */
export async function listSelfListedCards(
  limit = 24,
  locale?: string,
): Promise<SelfListedCard[]> {
  const rows = await prisma.coinCard.findMany({
    where: { status: "APPROVED", coinId: null },
    orderBy: [{ trust: "desc" }, { completeness: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true, slug: true, name: true, symbol: true,
      tagline: true, logoUrl: true, trust: true, completeness: true,
      sourceLocale: true, description: true, marketing: true,
      tokenomics: true, payments: true, legal: true,
      priceIndex: { select: { priceUsd: true, change24h: true } },
    },
  });
  return Promise.all(
    rows.map(async (row) => {
      const { priceIndex, sourceLocale, description, marketing, tokenomics, payments, legal, ...card } = row;
      return {
        ...card,
        tagline: locale
          ? await localizedTagline(
              { ...card, sourceLocale, description, marketing, tokenomics, payments, legal },
              locale,
            )
          : card.tagline,
        priceUsd: priceIndex?.priceUsd ?? null,
        change24h: priceIndex?.change24h ?? null,
      };
    }),
  );
}

type TaglineSource = Parameters<typeof collectCardProse>[0] & {
  id: string;
  tagline: string | null;
  sourceLocale: string | null;
};

/** Подпись на языке интерфейса; нет перевода в кеше — оригинал, не пустота. */
async function localizedTagline(card: TaglineSource, locale: string): Promise<string | null> {
  if (!card.tagline) return null;
  const res = await localizedProse({
    ns: "card",
    id: card.id,
    locale,
    sourceLocale: card.sourceLocale,
    fields: collectCardProse(card),
    cacheOnly: true,
  });
  return res.fields.tagline ?? card.tagline;
}

/** Count for the listing tab badge — cheaper than loading the rows. */
export async function countSelfListedCards(): Promise<number> {
  return prisma.coinCard.count({ where: { status: "APPROVED", coinId: null } });
}
