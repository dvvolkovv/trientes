import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "APPROVE_REQUEST"
  | "REJECT_REQUEST"
  | "ADD_COIN"
  | "TOGGLE_COIN_ACTIVE"
  | "SET_USER_ROLE";

export async function logAdminAction(input: {
  actorId: string;
  action: AuditAction;
  targetType: "CoinRequest" | "Coin" | "User";
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
