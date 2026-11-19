/**
 * Журнал действий предприятия (ТЗ 6.6: «кто, что и когда изменил»). Только вставка.
 *
 * Журнал не заменяет историю правок паспорта (`ProductEdit`, BB) и движения остатков
 * (`StockMovement`, BC): там лежат различия и количества, тут одна строка «кто, что и
 * когда». Сбой записи журнала работу не роняет — действие человека дороже строки
 * журнала (прецедент AN: `ensureCase` ловит и пишет в лог).
 */
import { prisma } from "@/lib/prisma";

export type CompanyAction =
  | "PROFILE_SAVED"
  | "POINT_SUBMITTED"
  | "POINT_UPDATED"
  | "POINT_CLAIMED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_EDIT_REVERTED"
  | "PRODUCT_CLAIM_SUBMITTED"
  | "PRODUCT_REVISION_DECIDED"
  | "PRODUCT_REVISION_WITHDRAWN"
  | "OFFER_SAVED"
  | "OFFER_STATUS_SET"
  | "OFFER_DELETED"
  | "CASHBACK_BASE_SET"
  | "CASHBACK_CATEGORY_SET"
  | "WAREHOUSE_CREATED"
  | "WAREHOUSE_RENAMED"
  | "WAREHOUSE_ARCHIVED"
  | "WAREHOUSE_RESTORED"
  | "MOVEMENT_RECORDED"
  | "MOVEMENT_RECEIVED"
  | "MOVEMENT_CANCELLED"
  | "MEMBER_ADDED"
  | "MEMBER_ROLE_SET"
  | "MEMBER_POINTS_SET"
  | "MEMBER_REMOVED"
  | "TEAM_ROLE_SAVED"
  | "TEAM_ROLE_DELETED"
  | "INVITE_CREATED"
  | "INVITE_REVOKED"
  | "INVITE_ACCEPTED"
  | "TASK_CREATED"
  | "TASK_UPDATED"
  | "TASK_STATUS_SET"
  | "TASK_CANCELLED"
  | "TASK_COMMENTED"
  | "PROMO_CREATED"
  | "PROMO_UPDATED"
  | "PROMO_ARCHIVED"
  | "PROMO_SENT"
  | "PROMO_RESTORED"
  | "SUPPLIER_SAVED"
  | "SUPPLIER_ARCHIVED"
  | "SUPPLIER_RESTORED"
  | "ORDER_CREATED"
  | "ORDER_SENT"
  | "ORDER_CONFIRMED"
  | "ORDER_DECLINED"
  | "ORDER_SHIPPED"
  | "ORDER_RECEIVED"
  | "ORDER_CLOSED"
  | "ORDER_CANCELLED"
  | "ORDER_DOC_ADDED"
  | "REORDER_RULE_SAVED"
  | "REORDER_RULE_DELETED";

export async function logCompanyAction(input: {
  companyId: string;
  actorUserId: string | null;
  action: CompanyAction;
  subject?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.companyActionLog.create({
      data: {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: input.action,
        subject: input.subject?.slice(0, 200) ?? null,
        meta: (input.meta ?? undefined) as never,
      },
    });
  } catch (error) {
    console.error("company_action_log_failed", input.companyId, input.action, error);
  }
}

/** Последние строки журнала. 200 — столько читает человек, а не выгрузка. */
export const JOURNAL_PAGE = 200;

export async function readJournal(companyId: string, take = JOURNAL_PAGE) {
  return prisma.companyActionLog.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      subject: true,
      meta: true,
      createdAt: true,
      actor: { select: { username: true, name: true, email: true } },
    },
  });
}
