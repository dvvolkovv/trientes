"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { approveRequestCore } from "@/lib/admin/approve-request";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyUser } from "@/lib/notify";

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
    // Notify requestor (best-effort, never blocks the action). Goes to
    // whichever channel(s) the user opted into (Telegram and/or email).
    try {
      const r = await prisma.coinRequest.findUnique({
        where: { id: input.requestId },
        select: { userId: true, symbol: true, name: true },
      });
      if (r) {
        void notifyUser({
          userId: r.userId,
          text: `✅ Your coin request "${r.name} (${r.symbol})" was approved. It should appear on trientes.org within ~30 minutes.`,
          subject: `Coin request approved: ${r.symbol}`,
        });
      }
    } catch (err) {
      console.error("[admin-requests] approve notify failed:", err);
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
  // Notify requestor (best-effort, never blocks the action). Goes to
  // whichever channel(s) the user opted into (Telegram and/or email).
  try {
    void notifyUser({
      userId: req.userId,
      text: `❌ Your coin request "${req.name} (${req.symbol})" was not approved.\nReason: ${reason}\nYou can submit a new request with updated info if needed.`,
      subject: `Coin request not approved: ${req.symbol}`,
    });
  } catch (err) {
    console.error("[admin-requests] reject notify failed:", err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
