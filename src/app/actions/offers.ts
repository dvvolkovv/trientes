"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { validateOffer, type OfferInput } from "@/lib/products/offers-rules";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Цена, единица, ставка кэшбэка и правила продажи — одно предложение на пару
 * «предприятие × товар». Модерацию предложение не проходит: его публикует уже
 * залистованное предприятие, а снимают надзор над предприятием, надзор над паспортом и
 * сам продавец паузой.
 */
export async function saveOffer(companyId: string, productId: string, input: OfferInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  if (!canWrite(await editorCompany(companyId, userId))) return fail("forbidden");

  const v = validateOffer(input);
  if (!v.ok) return fail(v.reason);

  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, suspendedAt: null, mergedIntoId: null },
    select: { id: true, slug: true },
  });
  // Снятый надзором или слитый паспорт предложения не принимает: цена встала бы на
  // страницу, которой нет.
  if (!product) return fail("product_not_found");

  const data = {
    price: new Prisma.Decimal(v.value.price),
    currency: v.value.currency,
    unit: v.value.unit,
    cashbackPercent: v.value.cashbackPercent === null ? null : new Prisma.Decimal(v.value.cashbackPercent),
    saleRules: v.value.saleRules,
    onlineUrl: v.value.onlineUrl,
  };

  const offer = await prisma.productOffer.upsert({
    where: { companyId_productId: { companyId, productId } },
    create: { companyId, productId, ...data },
    update: data,
    select: { id: true, status: true },
  });

  revalidatePath(`/[locale]/product/${product.slug}`, "page");
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  return { ok: true as const, id: offer.id, status: offer.status };
}

/** Пауза — слово самого продавца «сейчас не продаю»: модерации тут не место. */
export async function setOfferStatus(companyId: string, productId: string, status: "ACTIVE" | "PAUSED") {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  if (!canWrite(await editorCompany(companyId, userId))) return fail("forbidden");

  const updated = await prisma.productOffer.updateMany({
    where: { companyId, productId },
    data: { status },
  });
  if (updated.count === 0) return fail("not_found");
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  return { ok: true as const };
}

/**
 * Снятие предложения. Удаляется именно оно, а не остатки и не движения: продавец мог
 * перестать продавать товар, но его склад и история остаются.
 */
export async function deleteOffer(companyId: string, productId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  if (!canWrite(await editorCompany(companyId, userId))) return fail("forbidden");

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { slug: true } });
  const deleted = await prisma.productOffer.deleteMany({ where: { companyId, productId } });
  if (deleted.count === 0) return fail("not_found");
  if (product) revalidatePath(`/[locale]/product/${product.slug}`, "page");
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  return { ok: true as const };
}
