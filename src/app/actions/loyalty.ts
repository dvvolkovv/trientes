"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { isProductCategory } from "@/lib/products/categories";
import { parseRate } from "@/lib/loyalty/rates";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

/** Сколько страниц товаров обновляем после смены ставки. Больше — вслух в лог. */
const REVALIDATE_LIMIT = 200;

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Ставка «на всё» и ставки категорий меняют число на страницах всех товаров продавца,
 * а не только на его витрине. Обновляем их по списку и честно говорим в лог, если
 * список пришлось обрезать: молчаливый потолок читался бы как «обновили все».
 */
async function revalidateCompanyOffers(companyId: string, category?: string) {
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  const offers = await prisma.productOffer.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      ...(category ? { product: { category } } : {}),
    },
    select: { product: { select: { slug: true } } },
    take: REVALIDATE_LIMIT + 1,
  });
  for (const o of offers.slice(0, REVALIDATE_LIMIT)) {
    revalidatePath(`/[locale]/product/${o.product.slug}`, "page");
  }
  if (offers.length > REVALIDATE_LIMIT) {
    console.warn(`cashback revalidate truncated: company=${companyId} limit=${REVALIDATE_LIMIT}`);
  }
}

/**
 * Ставка кэшбэка «на всё». Модерацию не проходит: её объявляет уже залистованное
 * предприятие — то же право, которым оно правит паспорт (BB) и цену (BC).
 * Пустая строка снимает ставку, а не пишет ноль: «кэшбэк 0 %» — обещание, которого
 * никто не давал.
 */
export async function saveBaseRate(companyId: string, raw: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  if (!canWrite(await editorCompany(companyId, userId))) return fail("forbidden");

  const parsed = parseRate(raw);
  if (!parsed.ok) return fail(parsed.reason);

  await prisma.company.update({
    where: { id: companyId },
    data: {
      cashbackBasePercent: parsed.value === null ? null : new Prisma.Decimal(parsed.value),
    },
  });
  await revalidateCompanyOffers(companyId);
  return { ok: true as const, percent: parsed.value };
}

/** Ставка по категории. Пустая строка удаляет строку правила, а не записывает ноль. */
export async function saveCategoryRate(companyId: string, category: string, raw: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  if (!canWrite(await editorCompany(companyId, userId))) return fail("forbidden");
  if (!isProductCategory(category)) return fail("category_invalid");

  const parsed = parseRate(raw);
  if (!parsed.ok) return fail(parsed.reason);

  if (parsed.value === null) {
    await prisma.cashbackRule.deleteMany({ where: { companyId, category } });
  } else {
    const percent = new Prisma.Decimal(parsed.value);
    await prisma.cashbackRule.upsert({
      where: { companyId_category: { companyId, category } },
      create: { companyId, category, percent },
      update: { percent },
    });
  }
  await revalidateCompanyOffers(companyId, category);
  return { ok: true as const, percent: parsed.value };
}
