/**
 * Приглашение сотрудника. В базе лежит только sha256 ссылки: дамп таблицы не
 * должен давать доступ к админке (приём из сброса пароля). Жизненный цикл
 * ссылки — общий `invite-tokens.ts`, тот же, что у команд компаний и карточек.
 */
import { createHash } from "node:crypto";
import type { StaffLevel } from "@/lib/authz/policy";
import { queueByKey } from "@/lib/cases/queues";

export {
  INVITE_TTL_DAYS,
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
  isInviteUsable,
} from "@/lib/invite-tokens";

export type GrantInput = { queue: string; level: string; expiresAt?: string | null };
export type ParsedGrant = { queue: string; level: StaffLevel; expiresAt: Date | null };
export type ParseResult =
  | { ok: true; grants: ParsedGrant[] }
  | {
      ok: false;
      reason: "empty" | "unknown_queue" | "unknown_level" | "bad_date" | "duplicate_queue";
    };

const LEVELS: StaffLevel[] = ["VIEW", "HANDLE", "APPROVE"];

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseGrants(raw: unknown): ParseResult {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: "empty" };
  const out: ParsedGrant[] = [];
  const seen = new Set<string>();
  for (const item of raw as GrantInput[]) {
    const queue = String(item?.queue);
    if (!queueByKey(queue)) return { ok: false, reason: "unknown_queue" };
    // Одна очередь дважды — уровень был бы неоднозначен, и @@unique всё равно
    // уронил бы запись: отвечаем до базы, понятными словами.
    if (seen.has(queue)) return { ok: false, reason: "duplicate_queue" };
    seen.add(queue);
    if (!LEVELS.includes(item?.level as StaffLevel)) return { ok: false, reason: "unknown_level" };
    let expiresAt: Date | null = null;
    if (item.expiresAt) {
      const d = new Date(item.expiresAt);
      if (Number.isNaN(d.getTime())) return { ok: false, reason: "bad_date" };
      expiresAt = d;
    }
    out.push({ queue, level: item.level as StaffLevel, expiresAt });
  }
  return { ok: true, grants: out };
}

export function buildStaffInviteUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/staff-invite/${token}`;
}

/** Полгода — обычная частота ревизии доступа в SOC 2 и ISO 27001. */
export const ACCESS_REVIEW_MONTHS = 6;

export function accessReviewAt(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + ACCESS_REVIEW_MONTHS);
  return d;
}
