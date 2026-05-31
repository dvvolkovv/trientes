"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyGeoForPoint } from "@/lib/geo-alerts-notify";
import { notifyUser } from "@/lib/notify";

async function ownerIdOfPoint(companyId: string): Promise<string | null> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { ownerUserId: true } });
  return c?.ownerUserId ?? null;
}

export async function approvePoint(input: { pointId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };
  if (point.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { status: "APPROVED", reviewedById: admin.userId, reviewedAt: new Date(), rejectReason: null },
  });
  await logAdminAction({
    actorId: admin.userId, action: "APPROVE_POINT", targetType: "CompanyPoint", targetId: point.id,
    details: { name: point.name, companyId: point.companyId },
  });
  void notifyGeoForPoint({
    id: point.id, name: point.name, countryCode: point.countryCode, companyId: point.companyId,
  }).catch(() => {});
  void (async () => {
    const ownerId = await ownerIdOfPoint(point.companyId);
    if (!ownerId) return;
    await notifyUser({
      userId: ownerId,
      text: `✅ Your point "${point.name}" was approved and is now visible on the navigator.`,
      subject: `Point approved: ${point.name}`,
    });
  })().catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectPoint(input: { pointId: string; rejectReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.rejectReason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };
  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };
  if (point.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { status: "REJECTED", reviewedById: admin.userId, reviewedAt: new Date(), rejectReason: reason },
  });
  await logAdminAction({
    actorId: admin.userId, action: "REJECT_POINT", targetType: "CompanyPoint", targetId: point.id,
    details: { reason },
  });
  void (async () => {
    const ownerId = await ownerIdOfPoint(point.companyId);
    if (!ownerId) return;
    await notifyUser({
      userId: ownerId,
      text: `❌ Your point "${point.name}" was not approved.\nReason: ${reason}`,
      subject: `Point not approved: ${point.name}`,
    });
  })().catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}
