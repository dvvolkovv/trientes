"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAnyQueue } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";

export type SupervisionResult = { ok: true } | { ok: false; reason: string };

/**
 * Снять точку с карты до выяснения. Статус APPROVED не трогаем: это надзор, а
 * не отмена прошлого решения модератора — вернуть точку должно быть можно одним
 * действием, не прогоняя её через очередь заново.
 */
export async function suspendPoint(input: {
  pointId: string;
  reason: string;
}): Promise<SupervisionResult> {
  const admin = await requireAnyQueue(["points", "pointReports"], "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };

  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };

  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { suspendedAt: new Date(), suspendReason: reason.slice(0, 500) },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "SUSPEND_POINT",
    targetType: "CompanyPoint",
    targetId: point.id,
    details: { reason: reason.slice(0, 500) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Вернуть точку на карту и снять пометку: жалоба не подтвердилась. */
export async function clearPointReview(input: { pointId: string }): Promise<SupervisionResult> {
  const admin = await requireAnyQueue(["points", "pointReports"], "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };

  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { underReviewAt: null, suspendedAt: null, suspendReason: null },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "UNSUSPEND_POINT",
    targetType: "CompanyPoint",
    targetId: point.id,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
