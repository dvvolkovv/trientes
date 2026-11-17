/**
 * Что считается видимым предприятием — в одном месте, а не пятью копиями по
 * выборкам. Своя копия правила в проекте уже однажды отставала (список локалей),
 * и правило видимости — ровно такой же случай: до слайса AR на статус компании
 * не смотрели ни карточки монет, ни каталог услуг.
 */
import type { CaseRisk } from "@prisma/client";

/** Фрагмент `where` для связи `company` в публичных выборках. */
export const PUBLIC_COMPANY = { status: "APPROVED", deletedAt: null, suspendedAt: null } as const;

/**
 * Карточка монеты: у посеянных нами компании нет вовсе, и прятать их не за что.
 * Поэтому условие пропускает `companyId = null` явно, а не молча через связь.
 */
export const LIVE_CARD_COMPANY = {
  OR: [{ companyId: null }, { company: { deletedAt: null, suspendedAt: null } }],
} as const;

/** За сколько дней до срока пересмотра звонит колокольчик. */
export const REVIEW_NOTICE_DAYS = 30;

/** Срок следующего пересмотра: 12 месяцев, при высоком риске 6. */
export function nextReviewAt(from: Date, risk: CaseRisk): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + (risk === "HIGH" ? 6 : 12));
  return d;
}

export function reviewDueSoon(due: Date | null, now: Date): boolean {
  if (!due) return false;
  return due.getTime() - now.getTime() <= REVIEW_NOTICE_DAYS * 86_400_000;
}
