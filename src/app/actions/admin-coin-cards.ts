"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approveCoinCardCore, rejectCoinCardCore } from "@/lib/admin/approve-coin-card";

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "ADMIN") return null;
  return user.id;
}

export async function approveCoinCard(
  cardId: string,
): Promise<{ ok: boolean; reason?: string; slug?: string }> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };

  const res = await approveCoinCardCore(prisma, { cardId, reviewerId: adminId });
  if (res.ok) {
    await prisma.adminAuditLog.create({
      data: {
        actorId: adminId,
        action: "APPROVE_COIN_CARD",
        targetType: "CoinCard",
        targetId: cardId,
        details: { slug: res.slug },
      },
    });
    revalidatePath("/", "layout");
  }
  return res;
}

export async function rejectCoinCard(
  cardId: string,
  reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };

  const res = await rejectCoinCardCore(prisma, { cardId, reviewerId: adminId, reason });
  if (res.ok) {
    await prisma.adminAuditLog.create({
      data: {
        actorId: adminId,
        action: "REJECT_COIN_CARD",
        targetType: "CoinCard",
        targetId: cardId,
        details: { reason },
      },
    });
    revalidatePath("/", "layout");
  }
  return res;
}
