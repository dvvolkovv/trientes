"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { approveRequestCore } from "@/lib/admin/approve-request";
import { logAdminAction } from "@/lib/admin/audit";
import { sendEmail } from "@/lib/email";

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
    // Notify requestor (best-effort, never blocks the action).
    try {
      const r = await prisma.coinRequest.findUnique({
        where: { id: input.requestId },
        include: { user: { select: { email: true } } },
      });
      if (r?.user?.email) {
        void sendEmail({
          to: r.user.email,
          subject: `Your coin request was approved: ${r.symbol}`,
          text: `Good news — your request to add ${r.name} (${r.symbol}) was approved. It will appear on trientes.org within ~30 minutes once price data syncs.`,
        });
      }
    } catch (err) {
      console.error("[admin-requests] approve email lookup failed:", err);
    }
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
  // Notify requestor (best-effort, never blocks the action).
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { email: true },
    });
    if (u?.email) {
      void sendEmail({
        to: u.email,
        subject: `Your coin request was not approved: ${req.symbol}`,
        text: `Your request to add ${req.name} (${req.symbol}) was not approved.\n\nReason: ${reason}\n\nYou can submit a new request with updated info if needed.`,
      });
    }
  } catch (err) {
    console.error("[admin-requests] reject email lookup failed:", err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
