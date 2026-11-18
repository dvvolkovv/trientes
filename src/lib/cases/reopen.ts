import type { CaseSubjectType } from "@prisma/client";
import { computeDue } from "./sla";

/**
 * Повторное открытие дела.
 *
 * Заведение дела идемпотентно, и это верно для повторной подачи того же
 * объекта. Но объект возвращается на модерацию и после решения: правка
 * одобренной точки стирает прежнее решение, отказанный KYB подаётся заново.
 * Дело при этом оставалось закрытым — заявка ждала, а в очереди её не было.
 *
 * Решения внутри:
 * - `openedAt` не трогаем: первое обращение человека — факт, и возраст в плитке
 *   очереди должен считаться от него. Срок считается от повторной подачи:
 *   проверяющий не виноват, что заявитель вернулся через месяц.
 * - Обе подписи и решение стираются: они относились к другой версии объекта.
 * - Дело уходит из чьих-то рук в общий котёл. Прежний исполнитель мог давно
 *   уйти, а строка «ведёт такой-то» в очереди означала бы, что делом занимаются.
 */
export function reopenPatch(now: Date, subjectType: CaseSubjectType) {
  const { dueAt, slaSeconds } = computeDue(now, subjectType);
  return {
    status: "NEW" as const,
    reopenedAt: now,
    dueAt,
    slaSeconds,
    clockStoppedAt: null,
    assigneeId: null,
    decision: null,
    decisionReason: null,
    decidedAt: null,
    reviewedById: null,
    reviewedAt: null,
    approvedById: null,
    approvedAt: null,
    soleSignOff: false,
  };
}
