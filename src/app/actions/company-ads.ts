"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureCase } from "@/lib/cases/ensure";
import { appendCaseEvent } from "@/lib/cases/journal";
import { isOpen } from "@/lib/cases/types";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import {
  AD_EDITS_PER_DAY,
  MAX_ADS,
  MAX_CAROUSEL_SLIDES,
  adSlides,
  parseAdInput,
  type AdInput,
} from "@/lib/ads/rules";
import {
  adEditMode,
  adSlotsTaken,
  type AdSlotRow,
  adSubmittable,
  adWithdrawable,
  type AdStatus,
} from "@/lib/ads/moderation";

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
 * Сколько мест карусели занято **кроме** этого материала (слайс CE): места считаются
 * в кадрах, и материал с восемью кадрами занимает карусель целиком.
 */
async function slotsTakenByOthers(companyId: string, adId: string): Promise<number> {
  const rows = await prisma.companyAd.findMany({
    where: { companyId, id: { not: adId } },
    select: { status: true, slides: true, mediaKind: true, mediaUrl: true, posterUrl: true },
  });
  return adSlotsTaken(rows as unknown as AdSlotRow[]);
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

/**
 * Правка материала (слайс CC изменил правило).
 *
 * Не опубликованный материал правится в колонках: снаружи его нет, защищать нечего
 * (тот же разбор, которым BM пустил правки непрошедшего модерацию предприятия).
 * Материал **на проверке** не правится вовсе — иначе модератор смотрит один ролик,
 * а в карусель уезжает другой; для этого есть отзыв. Правка **опубликованного**
 * ложится слепком, а в карусели остаётся прежний, уже одобренный материал.
 */
export async function updateAd(adId: string, input: AdInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ad = await prisma.companyAd.findUnique({
    where: { id: adId },
    select: { id: true, companyId: true, status: true, title: true },
  });
  if (!ad) return fail("not_found");
  const gate = await editorCompany(ad.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  const mode = adEditMode(ad.status as AdStatus);
  if (mode === "frozen") return fail("on_review");

  const parsed = parseAdInput(input);
  if (!parsed.ok) return fail(parsed.reason);
  const linkError = await checkAction(ad.companyId, parsed.value, gate!.pointScope);
  if (linkError) return fail(linkError);
  if (await overDailyLimit(ad.companyId)) return fail("daily_limit");

  if (mode === "proposal") {
    // Правка, добавляющая кадры, тоже обязана влезть в карусель: иначе модератор
    // одобрил бы её и получил отказ по потолку на уже проверенной работе.
    const others = await slotsTakenByOthers(ad.companyId, ad.id);
    if (others + parsed.value.slides.length > MAX_CAROUSEL_SLIDES) {
      return fail("too_many_published");
    }
    // Храним форму, а не разобранные значения: на одобрении слепок проходит ту же
    // проверку, что живая форма. Новая правка гасит прежнюю — ждущих правок у
    // материала не бывает двух (прецедент: новая просьба о сбросе пароля гасит
    // прежние ссылки).
    await prisma.companyAd.update({
      where: { id: adId },
      data: {
        pendingPayload: input as unknown as Prisma.InputJsonValue,
        pendingAt: new Date(),
        rejectionReason: null,
      },
    });
    await logCompanyAction({
      companyId: ad.companyId, actorUserId: userId,
      action: "AD_CHANGES_SUBMITTED", subject: parsed.value.title,
    });
    await openAdCase(ad.id, ad.companyId, parsed.value.title);
    revalidateCard(ad.companyId);
    return { ok: true as const, pending: true as const };
  }

  await prisma.companyAd.update({ where: { id: adId }, data: { ...parsed.value } });
  await logCompanyAction({
    companyId: ad.companyId, actorUserId: userId, action: "AD_UPDATED", subject: parsed.value.title,
  });
  revalidateCard(ad.companyId);
  return { ok: true as const };
}

/**
 * Дело на материал. Заводится при отправке на проверку и при правке
 * опубликованного; решённое дело при этом открывается заново — это и есть
 * `ensureCase` (AT). Сбой заведения дела подачу не роняет (правило AN).
 */
async function openAdCase(adId: string, companyId: string, title: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ownerUserId: true },
  });
  await ensureCase({
    subjectType: "COMPANY_AD",
    subjectId: adId,
    title,
    // Отвечает за сказанное владелец: материал мог завести маркетолог.
    applicantUserId: company?.ownerUserId ?? null,
  });
}

/**
 * Отправка материала на проверку (слайс CC). Публикует модератор, а продавец
 * встаёт в очередь: место в карусели занимает уже отправленный, иначе потолок
 * вскрылся бы в момент одобрения — отказом по делу, которое уже проверено.
 */
export async function submitAd(adId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ad = await prisma.companyAd.findUnique({
    where: { id: adId },
    select: {
      id: true, companyId: true, status: true, title: true,
      slides: true, mediaKind: true, mediaUrl: true, posterUrl: true,
    },
  });
  if (!ad) return fail("not_found");
  const gate = await editorCompany(ad.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");
  if (!adSubmittable(ad.status as AdStatus)) return fail("not_submittable");
  if (!ad.mediaUrl || !ad.title.trim()) return fail("incomplete");

  // Места считаются в кадрах (слайс CE): материал на четыре кадра не встанет в
  // очередь, если свободных мест три, — и это говорится отказом, а не обрезкой.
  const others = await slotsTakenByOthers(ad.companyId, ad.id);
  if (others + adSlides(ad).length > MAX_CAROUSEL_SLIDES) {
    return fail("too_many_published");
  }

  await prisma.companyAd.update({
    where: { id: adId },
    data: { status: "PENDING", submittedAt: new Date(), rejectionReason: null, decidedAt: null, decidedById: null },
  });
  await logCompanyAction({
    companyId: ad.companyId, actorUserId: userId, action: "AD_SUBMITTED", subject: ad.title,
  });
  await openAdCase(ad.id, ad.companyId, ad.title);
  revalidateCard(ad.companyId);
  return { ok: true as const };
}

/**
 * Отзыв с проверки: материал возвращается в черновик, ждущая правка стирается.
 *
 * Дело закрывается **без решения** (прецедент `withdrawKyb` в AT): проверяющий
 * работы не делал, и в аналитике труда отзыв работой выглядеть не должен.
 */
export async function withdrawAd(adId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const ad = await prisma.companyAd.findUnique({
    where: { id: adId },
    select: { id: true, companyId: true, status: true, title: true, pendingPayload: true },
  });
  if (!ad) return fail("not_found");
  const gate = await editorCompany(ad.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");
  const hasPending = ad.pendingPayload !== null && ad.pendingPayload !== undefined;
  if (!adWithdrawable({ status: ad.status as AdStatus, hasPending })) return fail("not_withdrawable");

  await prisma.companyAd.update({
    where: { id: adId },
    data: {
      // Отзыв правки опубликованного материала статуса не меняет: в карусели
      // остаётся то, что одобрено.
      ...(ad.status === "PENDING" ? { status: "DRAFT" as const, submittedAt: null } : {}),
      pendingPayload: Prisma.DbNull,
      pendingAt: null,
    },
  });

  const existing = await prisma.complianceCase.findUnique({
    where: { subjectType_subjectId: { subjectType: "COMPANY_AD", subjectId: adId } },
    select: { id: true, status: true },
  });
  if (existing && isOpen(existing.status)) {
    await prisma.complianceCase.update({
      where: { id: existing.id },
      data: { status: "CLOSED", decidedAt: new Date(), clockStoppedAt: null, assigneeId: null },
    });
    await appendCaseEvent({
      caseId: existing.id,
      actorId: userId,
      actorSide: "APPLICANT",
      kind: "STATUS_CHANGED",
      payload: { from: existing.status, to: "CLOSED", why: "withdrawn" },
    });
  }

  await logCompanyAction({
    companyId: ad.companyId, actorUserId: userId, action: "AD_WITHDRAWN", subject: ad.title,
  });
  revalidateCard(ad.companyId);
  return { ok: true as const };
}

/**
 * Архив и возврат из архива. Публикация сюда больше не входит (слайс CC): её
 * делает модератор, и кнопки «опубликовать» у продавца нет вовсе — погашенная
 * кнопка, которую действие всё равно отвергает, хуже её отсутствия (правило BI).
 *
 * Возврат из архива ведёт в черновик, а не в карусель: содержание могло пролежать
 * месяцы, и «когда-то одобрено» не значит «одобрено сейчас». Материал не удаляется:
 * показанное обещание люди видели.
 */
export async function setAdStatus(adId: string, status: "DRAFT" | "ARCHIVED") {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  if (status !== "DRAFT" && status !== "ARCHIVED") return fail("moderated_only");
  const ad = await prisma.companyAd.findUnique({
    where: { id: adId },
    select: { id: true, companyId: true, title: true, status: true },
  });
  if (!ad) return fail("not_found");
  const gate = await editorCompany(ad.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");
  // Материал на проверке убирают отзывом, а не сменой статуса: иначе дело осталось
  // бы открытым на объекте, которого в очереди уже нет смысла смотреть.
  if (ad.status === "PENDING") return fail("on_review");

  await prisma.companyAd.update({
    where: { id: adId },
    data: {
      status,
      // Уходя из карусели, материал забирает с собой и ждущую правку: применять её
      // к архивному нечему.
      ...(status === "ARCHIVED" ? { pendingPayload: Prisma.DbNull, pendingAt: null } : {}),
    },
  });
  await logCompanyAction({
    companyId: ad.companyId,
    actorUserId: userId,
    action: status === "ARCHIVED" ? "AD_ARCHIVED" : "AD_UPDATED",
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
