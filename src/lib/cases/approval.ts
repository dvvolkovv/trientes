/**
 * Правило четырёх глаз: проверил один, утвердил другой.
 *
 * Оговорка, без которой правило ломает систему: оно требует двух живых людей.
 * Останься в системе один сотрудник — одобрение заблокировалось бы навсегда.
 * Поэтому единственный сотрудник решение проводит, но с отметкой `soleSignOff`,
 * и в журнале это написано словами. Молчаливое послабление было бы хуже
 * отсутствия правила.
 */

export type ApproverRow = {
  userId: string;
  /** Уровень в очереди дела; `null` — гранта нет (владелец). */
  level: "VIEW" | "HANDLE" | "APPROVE" | null;
  expiresAt: Date | null;
  /** Отзыв доступа сотрудника. */
  revokedAt: Date | null;
  role: "USER" | "STAFF" | "OWNER" | "ADMIN";
};

/**
 * Сколько людей, кроме проверившего, вправе поставить вторую подпись **в этой
 * очереди**. Прежде считались все `ADMIN` подряд, и правило четырёх глаз было
 * декорацией: три записи одного владельца выглядели как три человека, а
 * сотрудник с правом «ведёт» засчитывался утверждающим.
 */
export function countApprovers(rows: ApproverRow[], reviewedById: string, now: Date): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.userId === reviewedById) continue;
    if (r.revokedAt) continue;
    const owner = r.role === "OWNER" || r.role === "ADMIN";
    if (!owner) {
      if (r.role !== "STAFF") continue;
      if (r.level !== "APPROVE") continue;
      if (r.expiresAt && r.expiresAt.getTime() <= now.getTime()) continue;
    }
    seen.add(r.userId);
  }
  return seen.size;
}

export type ApprovalBlocker =
  | "checks_pending"
  | "documents_resubmit"
  | "not_reviewed"
  | "same_person";

export type ApprovalInput = {
  /** Обязательных пунктов листа без ответа. */
  requiredPending: number;
  /** Документов, по которым запрошена новая присылка. */
  resubmitDocs: number;
  /** Первая подпись: кто проверил. */
  reviewedById: string | null;
  /** Кто сейчас нажимает «Одобрить». */
  meId: string;
  /** Сотрудников, способных поставить вторую подпись, кроме проверившего. */
  otherApproversCount: number;
};

export function approvalBlockers(input: ApprovalInput): ApprovalBlocker[] {
  const out: ApprovalBlocker[] = [];
  if (input.requiredPending > 0) out.push("checks_pending");
  if (input.resubmitDocs > 0) out.push("documents_resubmit");
  if (!input.reviewedById) out.push("not_reviewed");
  // Сам себя утвердить нельзя — но только пока есть кому утвердить вместо тебя.
  else if (input.reviewedById === input.meId && input.otherApproversCount > 0) {
    out.push("same_person");
  }
  return out;
}

export function canApprove(input: ApprovalInput): boolean {
  return approvalBlockers(input).length === 0;
}

/** Утверждение проходит одним лицом: проверивший и утвердивший — один человек. */
export function isSoleSignOff(input: ApprovalInput): boolean {
  return (
    !!input.reviewedById &&
    input.reviewedById === input.meId &&
    input.otherApproversCount === 0
  );
}

/**
 * Отказ второй подписи не требует: он ничего не публикует, а заявитель может
 * подать заново. Держать годную заявку в ожидании второго сотрудника хуже.
 * Единственное требование — внятная причина, порог тот же, что у старых экранов.
 */
export const REJECT_REASON_MIN = 3;

export function rejectBlockers(reason: string): "reason_too_short"[] {
  return reason.trim().length < REJECT_REASON_MIN ? ["reason_too_short"] : [];
}
