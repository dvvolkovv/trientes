/**
 * Чтение ставок кэшбэка. Правила — в `rates.ts`, здесь только выборка: ставка «на всё»
 * лежит у предприятия, ставки категорий — строками `CashbackRule`.
 */
import { prisma } from "@/lib/prisma";
import { cashbackSummary } from "@/lib/loyalty/rates";

export type CompanyRates = {
  base: number | null;
  /** Ставка по ключу категории паспорта (`PRODUCT_CATEGORIES`). */
  byCategory: Record<string, number>;
};

export async function readCompanyRates(companyId: string): Promise<CompanyRates> {
  const [company, rules] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { cashbackBasePercent: true } }),
    prisma.cashbackRule.findMany({ where: { companyId }, select: { category: true, percent: true } }),
  ]);
  return {
    base: company?.cashbackBasePercent === null || company === null ? null : Number(company.cashbackBasePercent),
    byCategory: Object.fromEntries(rules.map((r) => [r.category, Number(r.percent)])),
  };
}

/**
 * Ставки одной категории у многих предприятий — для раздела «Где взять»: у товара одна
 * категория, а продавцов до пятидесяти, и запрос на строку был бы тем же дефектом, что
 * слайс AD поймал на снимках монет.
 */
export async function readCategoryRates(
  companyIds: readonly string[],
  category: string,
): Promise<Map<string, number>> {
  if (companyIds.length === 0) return new Map();
  const rules = await prisma.cashbackRule.findMany({
    where: { companyId: { in: [...companyIds] }, category },
    select: { companyId: true, percent: true },
  });
  return new Map(rules.map((r) => [r.companyId, Number(r.percent)]));
}

/** Строка лояльности на витрине предприятия: база и лучшая категория. */
export async function readCashbackSummary(companyId: string) {
  const rates = await readCompanyRates(companyId);
  return cashbackSummary({ base: rates.base, categories: Object.values(rates.byCategory) });
}

/**
 * Сколько живых предложений у предприятия в каждой категории — чтобы в кабинете ставка
 * не ставилась наугад: продавец видит, на сколько своих товаров она подействует.
 */
export async function countOffersByCategory(companyId: string): Promise<Record<string, number>> {
  const rows = await prisma.productOffer.groupBy({
    by: ["productId"],
    where: { companyId, status: "ACTIVE" },
    _count: { _all: true },
  });
  if (rows.length === 0) return {};
  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) }, deletedAt: null, mergedIntoId: null },
    select: { category: true },
  });
  const counts: Record<string, number> = {};
  for (const p of products) counts[p.category] = (counts[p.category] ?? 0) + 1;
  return counts;
}
