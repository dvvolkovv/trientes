import type { AdminNotificationKind, CaseStatus } from "@prisma/client";
import { isOpen } from "./types";

export const DUE_SOON_SECONDS = 86400;

/** Молчание заявителя. Четырнадцать дней — то же число, что в слайсе AQ. */
export const SILENT_WAIT_SECONDS = 14 * 86400;

export type DueInput = {
  status: CaseStatus;
  assigneeId: string | null;
  dueAt: Date;
  clockStoppedAt: Date | null;
  lastStaffMessageAt: Date | null;
};

/**
 * Какой звонок нужен делу прямо сейчас — или ни одного.
 *
 * Дело без взявшего молчит: иначе каждый срок звонил бы всем админам сразу.
 * Пока часы стоят, про срок не звоним (он не течёт), но и бросать дело нельзя —
 * поэтому у стоящих часов свой повод: заявитель молчит две недели.
 */
export function dueNotificationFor(input: DueInput, now: Date): AdminNotificationKind | null {
  if (!isOpen(input.status)) return null;
  if (!input.assigneeId) return null;

  if (input.clockStoppedAt) {
    const since = input.lastStaffMessageAt ?? input.clockStoppedAt;
    const silent = (now.getTime() - since.getTime()) / 1000;
    return silent >= SILENT_WAIT_SECONDS ? "APPLICANT_SILENT" : null;
  }

  const left = (input.dueAt.getTime() - now.getTime()) / 1000;
  if (left <= 0) return "CASE_OVERDUE";
  if (left <= DUE_SOON_SECONDS) return "DUE_SOON";
  return null;
}
