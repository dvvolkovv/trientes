"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { AD_EDITS_PER_DAY, MAX_ADS, MAX_PUBLISHED_ADS, parseAdInput, type AdInput } from "@/lib/ads/rules";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function revalidateCard(companyId: string) {
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/ads`, "page");
}

/**
 * Потолок правок в сутки считается **до** работы (приём BC): счёт после записи
 * ограничивает только следующего, а не того, кто уже пишет пачкой.
 */
async function overDailyLimit(companyId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const n = await prisma.companyAd.count({ where: { companyId, updatedAt: { gte: since } } });
  return n >= AD_EDITS_PER_DAY;
}

/**
 * Привязки проверяются на принадлежность предприятию и на участок нажавшего — то же
 * правило, что у акции (BG) и задачи (BF): материал, ведущий на точку, которой
 * сотрудник не видит, был бы обещанием вслепую.
 */
async function checkAction(
  companyId: string,
  value: { action: string; productId: string | null; pointId: string | null },
  pointScope: string[],
): Promise<string | null> {
  if (value.action === "POINT" && value.pointId) {
    const point = await prisma.companyPoint.findFirst({
      where: { id: value.pointId, companyId, status: "APPROVED", deletedAt: null },
      select: { id: true },
    });
    if (!point) return "point_not_found";
    if (!pointScopeAllows(pointScope, value.pointId)) return "point_out_of_scope";
  }
  if (value.action === "PRODUCT" && value.productId) {
    // Вести можно только на то, что предприятие само продаёт: иначе реклама обещает
    // покупателю товар, которого у продавца нет (правило BG).
    const offer = await prisma.productOffer.findFirst({
      where: { companyId, productId: value.productId },
      select: { id: true },
    });
    if (!offer) return "product_not_offered";
  }
  return null;
}

export async function createAd(companyId: string, input: AdInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  const parsed = parseAdInput(input);
  if (!parsed.ok) return fail(parsed.reason);
  const linkError = await checkAction(companyId, parsed.value, gate!.pointScope);
  if (linkError) return fail(linkError);

  const total = await prisma.companyAd.count({ where: { companyId } });
  if (total >= MAX_ADS) return fail("too_many");
  if (await overDailyLimit(companyId)) return fail("daily_limit");

  const last = await prisma.companyAd.findFirst({
    where: { companyId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const ad = await prisma.companyAd.create({
    data: {
      companyId,
      ...parsed.value,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      createdById: userId,
    },
    select: { id: true },
  });
  await logCompanyAction({ companyId, actorUserId: userId, action: "AD_CREATED", subject: parsed.value.title });
  revalidateCard(companyId);
  return { ok: true as const, id: ad.id };
}

export async function updateAd(adId: string, input: AdInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ad = await prisma.companyAd.findUnique({ where: { id: adId }, select: { id: true, companyId: true } });
  if (!ad) return fail("not_found");
  const gate = await editorCompany(ad.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  const parsed = parseAdInput(input);
  if (!parsed.ok) return fail(parsed.reason);
  const linkError = await checkAction(ad.companyId, parsed.value, gate!.pointScope);
  if (linkError) return fail(linkError);
  if (await overDailyLimit(ad.companyId)) return fail("daily_limit");

  await prisma.companyAd.update({ where: { id: adId }, data: { ...parsed.value } });
  await logCompanyAction({
    companyId: ad.companyId, actorUserId: userId, action: "AD_UPDATED", subject: parsed.value.title,
  });
  revalidateCard(ad.companyId);
  return { ok: true as const };
}

/**
 * Статус. Публиковать можно, пока в карусели меньше пяти: шестую никто не долистает,
 * и молчаливое обрезание читалось бы как «показываем всё» (правило BL о потолках).
 * Материал не удаляется, а уходит в архив: показанное обещание люди видели.
 */
export async function setAdStatus(adId: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ad = await prisma.companyAd.findUnique({
    where: { id: adId },
    select: { id: true, companyId: true, title: true, status: true },
  });
  if (!ad) return fail("not_found");
  const gate = await editorCompany(ad.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  if (status === "PUBLISHED" && ad.status !== "PUBLISHED") {
    const live = await prisma.companyAd.count({ where: { companyId: ad.companyId, status: "PUBLISHED" } });
    if (live >= MAX_PUBLISHED_ADS) return fail("too_many_published");
  }

  await prisma.companyAd.update({ where: { id: adId }, data: { status } });
  await logCompanyAction({
    companyId: ad.companyId,
    actorUserId: userId,
    action: status === "PUBLISHED" ? "AD_PUBLISHED" : status === "ARCHIVED" ? "AD_ARCHIVED" : "AD_UPDATED",
    subject: ad.title,
  });
  revalidateCard(ad.companyId);
  return { ok: true as const };
}

/** Порядок в карусели: что человек увидит первым. Обмен соседей, а не перетаскивание. */
export async function moveAd(adId: string, direction: "up" | "down") {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ad = await prisma.companyAd.findUnique({
    where: { id: adId },
    select: { id: true, companyId: true, sortOrder: true, status: true },
  });
  if (!ad) return fail("not_found");
  const gate = await editorCompany(ad.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  const neighbour = await prisma.companyAd.findFirst({
    where: {
      companyId: ad.companyId,
      status: ad.status,
      sortOrder: direction === "up" ? { lt: ad.sortOrder } : { gt: ad.sortOrder },
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
    select: { id: true, sortOrder: true },
  });
  if (!neighbour) return fail("at_edge");

  await prisma.$transaction([
    prisma.companyAd.update({ where: { id: ad.id }, data: { sortOrder: neighbour.sortOrder } }),
    prisma.companyAd.update({ where: { id: neighbour.id }, data: { sortOrder: ad.sortOrder } }),
  ]);
  revalidateCard(ad.companyId);
  return { ok: true as const };
}
