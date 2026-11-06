// Чистая часть кнопки продавца. Держится отдельно от запросов (см.
// coin-card-merchant-viewer.ts), чтобы ссылки можно было проверять тестом,
// не втаскивая Auth.js и Prisma в прогон.

/**
 * Состояние посетителя карточки с точки зрения «могу ли я заявить приём».
 * Замкнутый цикл спеки F: карточка приводит продавца → продавец заводит точку
 * → точка делает карточку ценнее. Поэтому кнопка живёт на карточке, а не в
 * глубине кабинета.
 */
export type MerchantCta =
  | { kind: "login" }
  | { kind: "register_company" }
  | { kind: "add_point"; companyId: string }
  | { kind: "already"; companyId: string; points: number };

export type CtaContext = { locale: string; slug: string; cardId: string };

/** Чистая часть: куда ведёт кнопка в каждом состоянии. */
export function ctaHref(cta: MerchantCta, ctx: CtaContext): string {
  const { locale, slug, cardId } = ctx;
  switch (cta.kind) {
    case "login": {
      const next = `/${locale}/coin/${slug}#acceptance`;
      return `/${locale}/login?next=${encodeURIComponent(next)}`;
    }
    case "register_company":
      return `/${locale}/business`;
    case "add_point":
      // Спека рисует "#add-point?card=…", но фрагмент в URL всегда последний.
      return `/${locale}/cabinet/companies/${cta.companyId}?card=${encodeURIComponent(cardId)}#add-point`;
    case "already":
      return `/${locale}/cabinet/companies/${cta.companyId}#your-points`;
  }
}
