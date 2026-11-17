import type { CaseSubjectType, SlaState } from "./types";

/**
 * Срок в рабочих днях. Праздничного календаря в проекте нет и заводить его
 * ради этого не станем: суббота с воскресеньем — всё, что мы знаем наверняка.
 */
export const SLA_BUSINESS_DAYS: Record<CaseSubjectType, number> = {
  COIN_CARD: 5,
  COMPANY: 5,
  POINT: 3,
  EXCHANGE: 5,
  FINTECH: 5,
  KYB: 10,
  COIN_REQUEST: 5,
  POINT_REPORT: 3,
};

/** Доля срока, после которой точка желтеет. */
export const WARN_FRACTION = 0.25;

export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

export function computeDue(
  openedAt: Date,
  subjectType: CaseSubjectType,
): { dueAt: Date; slaSeconds: number } {
  const dueAt = addBusinessDays(openedAt, SLA_BUSINESS_DAYS[subjectType]);
  return { dueAt, slaSeconds: Math.round((dueAt.getTime() - openedAt.getTime()) / 1000) };
}

export function slaState(input: {
  now: Date;
  dueAt: Date;
  slaSeconds: number;
  clockStoppedAt: Date | null;
}): { state: SlaState; remainingSeconds: number } {
  // Пока часы стоят, остаток считается от момента остановки: простой заявителя
  // не должен съедать срок проверяющего.
  const at = input.clockStoppedAt ?? input.now;
  const remaining = Math.max(0, Math.round((input.dueAt.getTime() - at.getTime()) / 1000));
  if (input.clockStoppedAt) return { state: "paused", remainingSeconds: remaining };
  if (remaining <= 0) return { state: "late", remainingSeconds: 0 };
  if (remaining < input.slaSeconds * WARN_FRACTION) return { state: "warn", remainingSeconds: remaining };
  return { state: "ok", remainingSeconds: remaining };
}

export function pausePatch(now: Date): { clockStoppedAt: Date } {
  return { clockStoppedAt: now };
}

export function resumePatch(input: {
  dueAt: Date;
  clockStoppedAt: Date | null;
  now: Date;
}): { dueAt: Date; clockStoppedAt: null } {
  if (!input.clockStoppedAt) return { dueAt: input.dueAt, clockStoppedAt: null };
  const idle = input.now.getTime() - input.clockStoppedAt.getTime();
  return { dueAt: new Date(input.dueAt.getTime() + idle), clockStoppedAt: null };
}
