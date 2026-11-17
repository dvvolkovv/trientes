import { createHash } from "node:crypto";

/** Окно, в котором жалобы считаются относящимися к одному и тому же. */
export const REPORT_WINDOW_DAYS = 60;
/** Сколько независимых жалоб поднимают точку на проверку. */
export const ESCALATE_AT = 3;
/** Одна жалоба в сутки с адреса на одну точку. */
export const PER_IP_COOLDOWN_SECONDS = 86400;
/** Молчание предприятия до предупреждения и от предупреждения до снятия. */
export const OWNER_WAIT_SECONDS = 14 * 86400;

/**
 * Соль берётся из того же секрета, которым подписываются сеансы: отдельный ключ
 * пришлось бы заводить в .env на всех машинах, а дамп таблицы не должен давать
 * обратный перебор адресов (их всего четыре миллиарда).
 */
function salt(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "trientes";
}

export function reporterIpHash(ip: string): string {
  return createHash("sha256").update(`${salt()}|${ip}`).digest("hex").slice(0, 32);
}

export function tooSoon(lastAt: Date | null, now: Date): boolean {
  if (!lastAt) return false;
  return (now.getTime() - lastAt.getTime()) / 1000 < PER_IP_COOLDOWN_SECONDS;
}

export type ReportRow = {
  reporterUserId: string | null;
  reporterIpHash: string;
  createdAt: Date;
};

/**
 * Независимость считается по человеку, если он вошёл, и по адресу, если нет.
 * Иначе один человек с телефона и с ноутбука закрыл бы магазин вдвоём.
 */
export function independentReporters(rows: ReportRow[], now: Date): number {
  const edge = now.getTime() - REPORT_WINDOW_DAYS * 86400_000;
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.createdAt.getTime() < edge) continue;
    keys.add(r.reporterUserId ? `u:${r.reporterUserId}` : `i:${r.reporterIpHash}`);
  }
  return keys.size;
}

export type Escalation = "REVIEW" | "WARN" | "SUSPEND" | null;

export type EscalationInput = {
  independent: number;
  underReviewAt: Date | null;
  askedAt: Date | null;
  warnedAt: Date | null;
  suspendedAt: Date | null;
  /** Последний ответ предприятия в нитке дела. */
  ownerRepliedAt: Date | null;
  now: Date;
};

/**
 * Один шаг за прогон: сначала пометка и вопрос, потом предупреждение, потом
 * снятие. Ответ предприятия останавливает лестницу — дальше решает человек, а
 * не часы: разговор начался, и автоматическое снятие посреди него было бы
 * хамством.
 */
export function escalationFor(input: EscalationInput): Escalation {
  if (input.suspendedAt) return null;
  if (input.independent < ESCALATE_AT) return null;
  if (!input.underReviewAt) return "REVIEW";

  const asked = input.askedAt;
  if (!asked) return "REVIEW";
  if (input.ownerRepliedAt && input.ownerRepliedAt.getTime() > asked.getTime()) return null;

  const since = (from: Date) => (input.now.getTime() - from.getTime()) / 1000;
  if (!input.warnedAt) return since(asked) >= OWNER_WAIT_SECONDS ? "WARN" : null;
  return since(input.warnedAt) >= OWNER_WAIT_SECONDS ? "SUSPEND" : null;
}
