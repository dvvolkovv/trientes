"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAnyQueue } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";

export type SupervisionResult = { ok: true } | { ok: false; reason: string };

/**
 * Решение по заявке производителя на владение паспортом. Принимается в очереди
 * `products` тем же путём, что прочие решения: лист проверок, две подписи, журнал.
 */
export async function approveProductClaim(input: { claimId: string }): Promise<SupervisionResult> {
  const admin = await requireAnyQueue(["products"], "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const claim = await prisma.productClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, status: true, productId: true, companyId: true },
  });
  if (!claim) return { ok: false, reason: "not_found" };
  if (claim.status !== "PENDING") return { ok: false, reason: "not_pending" };

  const product = await prisma.product.findFirst({
    where: { id: claim.productId, deletedAt: null },
    select: { id: true, ownerCompanyId: true, slug: true },
  });
  if (!product) return { ok: false, reason: "not_found" };
  // Второй хозяин у паспорта невозможен: первый уже закреплён решением.
  if (product.ownerCompanyId) return { ok: false, reason: "already_owned" };

  const company = await prisma.company.findFirst({
    where: { id: claim.companyId, status: "APPROVED", deletedAt: null, suspendedAt: null },
    select: { id: true },
  });
  // Паспорт нельзя отдать предприятию, которого нет на витрине: оно и товар свой
  // показать не сможет.
  if (!company) return { ok: false, reason: "company_not_listed" };

  await prisma.$transaction([
    prisma.product.update({ where: { id: product.id }, data: { ownerCompanyId: claim.companyId } }),
    prisma.productClaim.update({
      where: { id: claim.id },
      data: { status: "APPROVED", decidedById: admin.userId, decidedAt: new Date() },
    }),
  ]);
  await logAdminAction({
    actorId: admin.userId,
    action: "APPROVE_PRODUCT_CLAIM",
    targetType: "ProductClaim",
    targetId: claim.id,
    details: { productId: product.id, companyId: claim.companyId },
  });
  revalidatePath(`/[locale]/product/${product.slug}`, "page");
  return { ok: true };
}

export async function rejectProductClaim(input: {
  claimId: string;
  reason: string;
  /** Отказ без слов заявителю — закрытие спама пачкой. */
  silent?: boolean;
}): Promise<SupervisionResult> {
  const admin = await requireAnyQueue(["products"], "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };

  const claim = await prisma.productClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, status: true, productId: true },
  });
  if (!claim) return { ok: false, reason: "not_found" };
  if (claim.status !== "PENDING") return { ok: false, reason: "not_pending" };

  await prisma.productClaim.update({
    where: { id: claim.id },
    data: {
      status: "REJECTED",
      decidedById: admin.userId,
      decidedAt: new Date(),
      rejectReason: reason.slice(0, 500),
    },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "REJECT_PRODUCT_CLAIM",
    targetType: "ProductClaim",
    targetId: claim.id,
    details: { reason: reason.slice(0, 500), silent: input.silent === true },
  });
  return { ok: true };
}

/**
 * Снять паспорт с каталога до выяснения. Запись остаётся: её видели и по ней
 * высказались — то же решение, что у надзора над точкой и предприятием.
 */
export async function suspendProduct(input: { productId: string; reason: string }): Promise<SupervisionResult> {
  const admin = await requireAnyQueue(["products"], "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };

  const product = await prisma.product.findFirst({ where: { id: input.productId, deletedAt: null } });
  if (!product) return { ok: false, reason: "not_found" };

  await prisma.product.update({
    where: { id: product.id },
    data: { suspendedAt: new Date(), suspendReason: reason.slice(0, 500), suspendedById: admin.userId },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "SUSPEND_PRODUCT",
    targetType: "Product",
    targetId: product.id,
    details: { reason: reason.slice(0, 500) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Вернуть паспорт в каталог: жалоба не подтвердилась. */
export async function unsuspendProduct(input: { productId: string }): Promise<SupervisionResult> {
  const admin = await requireAnyQueue(["products"], "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const product = await prisma.product.findFirst({ where: { id: input.productId, deletedAt: null } });
  if (!product) return { ok: false, reason: "not_found" };

  await prisma.product.update({
    where: { id: product.id },
    data: { suspendedAt: null, suspendReason: null, suspendedById: null },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "UNSUSPEND_PRODUCT",
    targetType: "Product",
    targetId: product.id,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Признать паспорт дублем другого. Необратимым не делаем (`mergedIntoId` снимается тем
 * же действием с `intoId = null`): у товара без штрихкода дубли неизбежны, и ошибка
 * слияния не должна стоить паспорта.
 */
export async function mergeProduct(input: { productId: string; intoId: string | null }): Promise<SupervisionResult> {
  const admin = await requireAnyQueue(["products"], "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const product = await prisma.product.findFirst({ where: { id: input.productId, deletedAt: null } });
  if (!product) return { ok: false, reason: "not_found" };

  if (input.intoId) {
    if (input.intoId === product.id) return { ok: false, reason: "same_product" };
    const into = await prisma.product.findFirst({
      where: { id: input.intoId, deletedAt: null },
      select: { id: true, mergedIntoId: true },
    });
    if (!into) return { ok: false, reason: "target_not_found" };
    // Цепочка слияний означала бы, что страница ведёт на страницу, которая ведёт дальше.
    if (into.mergedIntoId) return { ok: false, reason: "target_merged" };
  }

  await prisma.product.update({ where: { id: product.id }, data: { mergedIntoId: input.intoId } });
  await logAdminAction({
    actorId: admin.userId,
    action: "MERGE_PRODUCT",
    targetType: "Product",
    targetId: product.id,
    details: { intoId: input.intoId },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
