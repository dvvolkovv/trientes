// Чистая часть кнопки продавца. Держится отдельно от запросов (см.
// coin-card-merchant-viewer.ts), чтобы ссылки можно было проверять тестом,
// не втаскивая Auth.js и Prisma в прогон.

/** Сколько компаний рисуем прямо в карточке, прежде чем уводить в кабинет. */
export const MERCHANT_COMPANY_LIMIT = 5;

export type MerchantCompany = {
  id: string;
  displayName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  /** Точек этой компании, уже принимающих эту карточку. */
  acceptedPoints: number;
};

/**
 * Состояние посетителя карточки с точки зрения «могу ли я заявить приём».
 * Система не выбирает за человека, от чьего имени он действует: если компания
 * хотя бы одна, состояние — `choose`, и выбор делает он.
 */
export type MerchantCta =
  | { kind: "login" }
  | { kind: "register_company" }
  | {
      kind: "choose";
      companies: MerchantCompany[];
      hasMore: boolean;
      acceptedTotal: number;
    };

export type CtaContext = { locale: string; slug: string; cardId: string };

/** Ссылка для состояний без выбора компании. */
export function ctaHref(
  cta: { kind: "login" } | { kind: "register_company" },
  ctx: CtaContext,
): string {
  if (cta.kind === "login") {
    const next = `/${ctx.locale}/coin/${ctx.slug}#acceptance`;
    return `/${ctx.locale}/login?next=${encodeURIComponent(next)}`;
  }
  return newCompanyHref(ctx);
}

/**
 * Форма точки конкретной компании с уже отмеченной монетой. Спека рисует
 * "#add-point?card=…", но фрагмент в URL всегда последний.
 */
export function addPointHref(companyId: string, ctx: CtaContext): string {
  return `/${ctx.locale}/cabinet/companies/${companyId}?card=${encodeURIComponent(ctx.cardId)}#add-point`;
}

/** Оформить ещё одну компанию, не потеряв монету по пути. */
export function newCompanyHref(ctx: CtaContext): string {
  return `/${ctx.locale}/cabinet?card=${encodeURIComponent(ctx.cardId)}#companies`;
}

/** Свои точки конкретной компании. */
export function manageHref(companyId: string, ctx: CtaContext): string {
  return `/${ctx.locale}/cabinet/companies/${companyId}#your-points`;
}

/**
 * Какие компании показать в карточке и сколько точек уже принимают монету.
 * Вперёд выходят те, где монета уже принимается: новая точка скорее всего
 * относится к той же компании.
 */
export function pickMerchantCompanies(rows: readonly MerchantCompany[]): {
  companies: MerchantCompany[];
  hasMore: boolean;
  acceptedTotal: number;
} {
  const sorted = [...rows].sort(
    (a, b) => b.acceptedPoints - a.acceptedPoints || a.displayName.localeCompare(b.displayName),
  );
  return {
    companies: sorted.slice(0, MERCHANT_COMPANY_LIMIT),
    hasMore: sorted.length > MERCHANT_COMPANY_LIMIT,
    // Сумма по всем компаниям, а не по первой найденной — в F1 это был баг.
    acceptedTotal: rows.reduce((n, c) => n + c.acceptedPoints, 0),
  };
}
