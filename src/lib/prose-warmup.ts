// Прогрев переводов. Мягкий дедлайн в localizedProse означает, что первый
// посетитель в новой локали видит оригинал, а перевод достаётся второму — для
// поискового робота, который заходит один раз, этого мало. Воркер прогоняет
// прозу по всем локалям заранее; кеш ключуется хешем текста, поэтому правка
// карточки сама заставит прогреть её снова.

import { SUPPORTED_LOCALES } from "@/lib/locales";
import { localizedProse } from "@/lib/localized-prose";
import { collectCardProse } from "@/lib/coin-card-prose";

type PrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      sourceLocale: string | null;
      tagline: string | null;
      description: string | null;
      marketing: unknown;
      tokenomics: unknown;
    }>>;
  };
  company: {
    findMany(args: unknown): Promise<Array<{ id: string; description: string | null }>>;
  };
  fintechCompany: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      description: string | null;
      feesSummary: string | null;
    }>>;
  };
};

/** Сколько переводов делаем за один проход — потолок на расход токенов. */
export const WARMUP_BUDGET = 200;

export async function warmProseTranslations(
  prisma: PrismaLike,
  budget = WARMUP_BUDGET,
): Promise<number> {
  let done = 0;
  const spend = async (fn: () => Promise<unknown>) => {
    if (done >= budget) return false;
    await fn();
    done += 1;
    return true;
  };

  const cards = await prisma.coinCard.findMany({
    where: { status: "APPROVED" },
    select: {
      id: true, sourceLocale: true, tagline: true,
      description: true, marketing: true, tokenomics: true,
    },
    take: 200,
  });
  for (const card of cards) {
    const fields = collectCardProse(card);
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === card.sourceLocale) continue;
      const ok = await spend(() =>
        localizedProse({ ns: "card", id: card.id, locale, sourceLocale: card.sourceLocale, fields }),
      );
      if (!ok) return done;
    }
  }

  const companies = await prisma.company.findMany({
    where: { status: "APPROVED", deletedAt: null, description: { not: null } },
    select: { id: true, description: true },
    take: 200,
  });
  for (const c of companies) {
    for (const locale of SUPPORTED_LOCALES) {
      const ok = await spend(() =>
        localizedProse({
          ns: "company", id: c.id, locale, sourceLocale: null,
          fields: { description: c.description },
        }),
      );
      if (!ok) return done;
    }
  }

  const fintechs = await prisma.fintechCompany.findMany({
    where: { status: "APPROVED" },
    select: { id: true, description: true, feesSummary: true },
    take: 200,
  });
  for (const f of fintechs) {
    for (const locale of SUPPORTED_LOCALES) {
      const ok = await spend(() =>
        localizedProse({
          ns: "fintech", id: f.id, locale, sourceLocale: null,
          fields: { description: f.description, feesSummary: f.feesSummary },
        }),
      );
      if (!ok) return done;
    }
  }

  return done;
}
