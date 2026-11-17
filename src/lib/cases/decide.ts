import type { CaseSubjectType } from "@prisma/client";
import { approveCoinCard, rejectCoinCard } from "@/app/actions/admin-coin-cards";
import { approveCompany, rejectCompany } from "@/app/actions/admin-company";
import { approvePoint, rejectPoint } from "@/app/actions/admin-points";
import { approveExchange, rejectExchange } from "@/app/actions/admin-exchange";
import { approveFintech, rejectFintech } from "@/app/actions/admin-fintech";
import { approveRequest, rejectRequest } from "@/app/actions/admin-requests";
import { approveKyb, rejectKyb } from "@/app/actions/kyb";

/**
 * Применение решения дела к самому объекту заявки.
 *
 * Статус объекта (`CoinCard.status`, `Company.status`…) остаётся источником
 * правды для публикации — дело ведёт процесс, а не заменяет его. Поэтому здесь
 * зовутся те же проверенные экшены, которыми раньше пользовались старые экраны
 * очередей, а не переписанная копия их логики: расхождение двух реализаций
 * одного решения вылезло бы через месяц.
 */

export type ApplyResult = { ok: true } | { ok: false; reason: string };

function normalize(res: { ok: boolean; reason?: string }): ApplyResult {
  return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "failed" };
}

export async function applyDecision(input: {
  subjectType: CaseSubjectType;
  subjectId: string;
  decision: "APPROVED" | "REJECTED";
  reason: string;
}): Promise<ApplyResult> {
  const { subjectId, decision, reason } = input;
  const approve = decision === "APPROVED";

  switch (input.subjectType) {
    case "COIN_CARD":
      return normalize(approve ? await approveCoinCard(subjectId) : await rejectCoinCard(subjectId, reason));
    case "COMPANY":
      return normalize(
        approve
          ? await approveCompany({ companyId: subjectId })
          : await rejectCompany({ companyId: subjectId, rejectionReason: reason }),
      );
    case "KYB":
      return normalize(
        approve ? await approveKyb({ companyId: subjectId }) : await rejectKyb({ companyId: subjectId, reason }),
      );
    case "POINT":
      return normalize(
        approve
          ? await approvePoint({ pointId: subjectId })
          : await rejectPoint({ pointId: subjectId, rejectReason: reason }),
      );
    case "EXCHANGE":
      return normalize(
        approve
          ? await approveExchange({ exchangeId: subjectId })
          : await rejectExchange({ exchangeId: subjectId, rejectionReason: reason }),
      );
    case "FINTECH":
      return normalize(
        approve
          ? await approveFintech({ id: subjectId })
          : await rejectFintech({ id: subjectId, rejectionReason: reason }),
      );
    case "COIN_REQUEST":
      return normalize(
        approve
          ? await approveRequest({ requestId: subjectId })
          : await rejectRequest({ requestId: subjectId, rejectReason: reason }),
      );
    case "POINT_REPORT":
      // У жалобы на точку своего статуса нет: решение по ней живёт в самом деле.
      // Объектную часть заводит слайс AQ.
      return { ok: true };
  }
}

/**
 * Объект уже решён вне дела (или исчез) — дело должно уйти из очереди, а не
 * висеть в ней вечно. Такое возможно у дел посева: их объекты решались на
 * старых экранах ещё до того, как дело появилось.
 */
export function isAlreadySettled(reason: string): boolean {
  return reason === "not_pending" || reason === "not_found" || reason === "already_verified";
}
