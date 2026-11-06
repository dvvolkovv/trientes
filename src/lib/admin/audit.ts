import { prisma } from "@/lib/prisma";
import type { AdminAction, Prisma } from "@prisma/client";

/**
 * Берётся прямо из enum'а базы: список поддерживался руками и уже отстал от
 * схемы (значения карточек монет в него не попали), а расхождение здесь — это
 * действие админа, которое невозможно записать в журнал.
 */
export type AuditAction = AdminAction;

export async function logAdminAction(input: {
  actorId: string;
  action: AuditAction;
  targetType: "CoinRequest" | "Coin" | "User" | "CompanyPoint" | "RegisteredExchange" | "Company" | "FintechCompany";
  targetId: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        details: input.details as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Audit failures must NOT block the underlying admin action.
    console.error("[audit] failed to log:", err);
  }
}
