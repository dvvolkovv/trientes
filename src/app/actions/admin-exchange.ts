"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";

export async function approveExchange(input: { exchangeId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const exchange = await prisma.registeredExchange.findUnique({ where: { id: input.exchangeId } });
  if (!exchange) return { ok: false, reason: "not_found" };
  if (exchange.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.registeredExchange.update({
    where: { id: exchange.id },
    data: { status: "APPROVED", rejectionReason: null },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "APPROVE_EXCHANGE",
    targetType: "RegisteredExchange",
    targetId: exchange.id,
    details: { displayName: exchange.displayName },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectExchange(input: { exchangeId: string; rejectionReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.rejectionReason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };
  const exchange = await prisma.registeredExchange.findUnique({ where: { id: input.exchangeId } });
  if (!exchange) return { ok: false, reason: "not_found" };
  if (exchange.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.registeredExchange.update({
    where: { id: exchange.id },
    data: { status: "REJECTED", rejectionReason: reason },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "REJECT_EXCHANGE",
    targetType: "RegisteredExchange",
    targetId: exchange.id,
    details: { reason },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
