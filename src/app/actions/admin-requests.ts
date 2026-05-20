"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { approveRequestCore } from "@/lib/admin/approve-request";
import { logAdminAction } from "@/lib/admin/audit";

export async function approveRequest(input: { requestId: string; coingeckoIdOverride?: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const res = await approveRequestCore(prisma as never, {
    requestId: input.requestId,
    reviewerId: admin.userId,
    coingeckoIdOverride: input.coingeckoIdOverride,
  });
  if (res.ok) {
    await logAdminAction({
      actorId: admin.userId,
      action: "APPROVE_REQUEST",
      targetType: "CoinRequest",
      targetId: input.requestId,
      details: { coinId: res.coinId },
    });
    revalidatePath("/", "layout");
  }
  return res;
}

export async function rejectRequest(input: { requestId: string; rejectReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.rejectReason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };

  const req = await prisma.coinRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "PENDING") return { ok: false, reason: "not_pending" };

  await prisma.coinRequest.update({
    where: { id: req.id },
    data: {
      status: "REJECTED",
      reviewedById: admin.userId,
      reviewedAt: new Date(),
      rejectReason: reason,
    },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "REJECT_REQUEST",
    targetType: "CoinRequest",
    targetId: req.id,
    details: { reason },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
