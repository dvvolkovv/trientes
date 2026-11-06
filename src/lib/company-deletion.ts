// Кто и как удаляет компанию или точку приёма. Чисто, без Prisma: решение о
// правах и о пороге голосования — это то место, где ошибка стоит дороже всего,
// поэтому каждая граница проверена тестом.

import type { CompanyRole } from "@prisma/client";

/** Запрос, который никто не рассмотрел за две недели, протух, а не висит. */
export const DELETION_TTL_DAYS = 14;
export const MAX_DELETION_REASON = 500;

export type DeletionRoute = "apply" | "request" | "forbidden";

/**
 * Решение владельца (2026-11-06): владелец компании удаляет сам, сотрудник с
 * правом редактирования — только через подтверждение владельцев, админ сайта —
 * всегда и с записью в журнал.
 */
export function routeDeletion(input: {
  role: CompanyRole | null;
  isSiteAdmin: boolean;
}): DeletionRoute {
  if (input.isSiteAdmin) return "apply";
  if (input.role === "OWNER") return "apply";
  if (input.role === "EDITOR") return "request";
  return "forbidden";
}

/**
 * Порог — все владельцы, кроме заявителя. При одном владельце вырождается в
 * «владелец подтвердил». Ноль невозможен: порог ноль означал бы, что запрос
 * одобряет сам себя.
 */
export function deletionThreshold(input: {
  ownerCount: number;
  requesterIsOwner: boolean;
}): number {
  const need = input.ownerCount - (input.requesterIsOwner ? 1 : 0);
  return Math.max(1, need);
}

/** Голосуют только владельцы и никогда — по своему же запросу. */
export function canVoteOnDeletion(input: {
  role: CompanyRole | null;
  userId: string;
  requestedById: string;
}): boolean {
  if (input.role !== "OWNER") return false;
  return input.userId !== input.requestedById;
}

export type ReasonResult =
  | { ok: true; reason: string | null }
  | { ok: false; error: "reason_too_long" };

/** Причина необязательна для члена компании и обязательна для админа (проверяется в действии). */
export function validateDeletionReason(raw: string | null | undefined): ReasonResult {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, reason: null };
  if (s.length > MAX_DELETION_REASON) return { ok: false, error: "reason_too_long" };
  return { ok: true, reason: s };
}

export function deletionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + DELETION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
