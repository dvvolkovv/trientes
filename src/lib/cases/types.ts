import type { CaseStatus, CaseSubjectType } from "@prisma/client";

export type { CaseStatus, CaseSubjectType };

/** Дело считается открытым, пока по нему не принято решение. */
export const OPEN_STATUSES: CaseStatus[] = [
  "NEW",
  "IN_REVIEW",
  "WAITING_APPLICANT",
  "READY_FOR_APPROVAL",
];

export function isOpen(status: CaseStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Состояние часов срока. */
export type SlaState = "ok" | "warn" | "late" | "paused";
