"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireQueue } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyUser } from "@/lib/notify";
import { MAX_CAROUSEL_SLIDES, adSlides } from "@/lib/ads/rules";
import { adSlotsTaken, readPendingPayload, type AdSlotRow } from "@/lib/ads/moderation";
import { logCompanyAction } from "@/lib/company-team/journal";

/**
 * Решение модератора по рекламному материалу (слайс CC).
 *
 * Два разных случая под одной кнопкой, и путать их нельзя: **первая публикация**
 * (материал `PENDING`) и **правка опубликованного** (слепок `pendingPayload`). В
 * первом случае «одобрить» выпускает материал в карусель, во втором — применяет
 * правку, а отказ оставляет в карусели прежний, уже одобренный материал.
 */

type Res = { ok: true } | { ok: false; reason: string };

function ownerText(title: string): string {
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

async function loadAd(adId: string) {
  return prisma.companyAd.findUnique({
    where: { id: adId },
    select: {
      id: true, companyId: true, title: true, status: true, pendingPayload: true,
      // Кадры нужны счёту мест: карусель считается в кадрах (слайс CE).
      slides: true, mediaKind: true, mediaUrl: true, posterUrl: true,
      company: { select: { id: true, displayName: true, ownerUserId: true, deletedAt: true } },
    },
  });
}

export async function approveAd(input: { adId: string }): Promise<Res> {
  const admin = await requireQueue("ads", "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const ad = await loadAd(input.adId);
  if (!ad || ad.company.deletedAt) return { ok: false, reason: "not_found" };

  const pending = readPendingPayload(ad.pendingPayload);
  const hasPending = ad.pendingPayload !== null && ad.pendingPayload !== undefined;
  // Слепок, который перестал проходить проверку формы (правило добавили после его
  // сохранения), применять нельзя — иначе правило обошли бы молча.
  if (hasPending && !pending) return { ok: false, reason: "payload_invalid" };
  if (ad.status !== "PENDING" && !pending) return { ok: false, reason: "not_pending" };

  // Место в карусели занимают опубликованные и ждущие; свой материал из счёта
  // исключаем — он и есть тот, кого публикуем. Считаются **кадры** (слайс CE):
  // материал на четыре кадра в три свободных места не влезает.
  const wantSlides = pending ? pending.slides.length : adSlides(ad).length;
  if (ad.status === "PENDING" || pending) {
    const rows = await prisma.companyAd.findMany({
      where: { companyId: ad.companyId, id: { not: ad.id } },
      select: { status: true, slides: true, mediaKind: true, mediaUrl: true, posterUrl: true },
    });
    if (adSlotsTaken(rows as unknown as AdSlotRow[]) + wantSlides > MAX_CAROUSEL_SLIDES) {
      return { ok: false, reason: "too_many_published" };
    }
  }

  await prisma.companyAd.update({
    where: { id: ad.id },
    data: {
      ...(pending ? pending : {}),
      status: "PUBLISHED",
      pendingPayload: Prisma.DbNull,
      pendingAt: null,
      rejectionReason: null,
      decidedAt: new Date(),
      decidedById: admin.userId,
    },
  });

  await logAdminAction({
    actorId: admin.userId,
    action: "APPROVE_COMPANY_AD",
    targetType: "CompanyAd",
    targetId: ad.id,
    details: { companyId: ad.companyId, kind: pending ? "revision" : "publish" },
  });
  // Журнал предприятия — тот же рассказ «кто, что и когда», что у прочих действий:
  // продавец должен видеть решение у себя, а не только в письме.
  await logCompanyAction({
    companyId: ad.companyId,
    actorUserId: null,
    action: "AD_APPROVED",
    subject: ad.title,
  });
  void notifyUser({
    userId: ad.company.ownerUserId,
    text: `✅ Your banner item "${ownerText(ad.title)}" was approved and is now live on Trientes.`,
    subject: `Banner item approved: ${ownerText(ad.title)}`,
    url: `https://trientes.org/en/cabinet/companies/${ad.companyId}/ads`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectAd(input: {
  adId: string;
  reason: string;
  silent?: boolean;
}): Promise<Res> {
  const admin = await requireQueue("ads", "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };

  const ad = await loadAd(input.adId);
  if (!ad) return { ok: false, reason: "not_found" };
  const hasPending = ad.pendingPayload !== null && ad.pendingPayload !== undefined;
  if (ad.status !== "PENDING" && !hasPending) return { ok: false, reason: "not_pending" };

  await prisma.companyAd.update({
    where: { id: ad.id },
    data: {
      // Отказ по правке опубликованного материала статуса не меняет: в карусели
      // остаётся то, что уже одобрено, а отвергнута только правка.
      ...(ad.status === "PENDING" ? { status: "REJECTED" as const } : {}),
      pendingPayload: Prisma.DbNull,
      pendingAt: null,
      rejectionReason: reason,
      decidedAt: new Date(),
      decidedById: admin.userId,
    },
  });

  await logAdminAction({
    actorId: admin.userId,
    action: "REJECT_COMPANY_AD",
    targetType: "CompanyAd",
    targetId: ad.id,
    details: { companyId: ad.companyId, reason, kind: hasPending ? "revision" : "publish" },
  });
  await logCompanyAction({
    companyId: ad.companyId,
    actorUserId: null,
    action: "AD_REJECTED",
    subject: ad.title,
  });
  if (input.silent !== true) {
    void notifyUser({
      userId: ad.company.ownerUserId,
      text: `❌ Your banner item "${ownerText(ad.title)}" was not accepted.\nReason: ${reason}`,
      subject: `Banner item rejected: ${ownerText(ad.title)}`,
      url: `https://trientes.org/en/cabinet/companies/${ad.companyId}/ads`,
    }).catch(() => {});
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
