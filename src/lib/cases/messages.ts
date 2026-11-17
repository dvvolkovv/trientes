import type { CaseStatus } from "@prisma/client";
import { isOpen } from "./types";

export type MessageSide = "STAFF" | "APPLICANT";

export const MESSAGE_MAX = 4000;

/** Заготовки в одно нажатие. Текст живёт в i18n на языке заявителя. */
export const TEMPLATE_KEYS = [
  "requestDocument",
  "clarifyData",
  "needTranslation",
  "deadline7",
] as const;

export type NormalizedBody =
  | { ok: true; body: string }
  | { ok: false; reason: "empty" | "too_long" };

/**
 * Текст без вложения обязателен: пустая реплика в нитке читается как сбой.
 * С вложением текст можно не писать — файл и есть сообщение.
 */
export function normalizeBody(raw: string, hasAttachments: boolean): NormalizedBody {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (body.length > MESSAGE_MAX) return { ok: false, reason: "too_long" };
  if (body.length === 0 && !hasAttachments) return { ok: false, reason: "empty" };
  return { ok: true, body };
}

export type ReadFlags = {
  side: MessageSide;
  readByStaffAt: Date | null;
  readByApplicantAt: Date | null;
};

/** Непрочитанное — только написанное другой стороной. */
export function unreadCount(messages: ReadFlags[], side: MessageSide): number {
  return messages.filter((m) =>
    side === "STAFF"
      ? m.side === "APPLICANT" && m.readByStaffAt === null
      : m.side === "STAFF" && m.readByApplicantAt === null,
  ).length;
}

/**
 * `null` — статус не меняется. Решённое дело сообщением не открывается:
 * вернуть его в работу должен человек, а не реплика в нитке.
 */
export function statusAfterStaffMessage(status: CaseStatus, needsReply: boolean): CaseStatus | null {
  if (!needsReply) return null;
  if (!isOpen(status)) return null;
  if (status === "WAITING_APPLICANT") return null;
  return "WAITING_APPLICANT";
}

export function statusAfterApplicantMessage(status: CaseStatus): CaseStatus | null {
  return status === "WAITING_APPLICANT" ? "IN_REVIEW" : null;
}
