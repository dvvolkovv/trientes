/**
 * Время в руках. Измерение заведомо приблизительное: оно меряет время с
 * открытым делом, а не время размышления. Поэтому правка руками разрешена,
 * но только с причиной и записью в журнал (см. adjustCaseTime).
 */

/** Нет биения дольше этого — человек ушёл, сеанс закрывается задним числом. */
export const IDLE_MS = 5 * 60 * 1000;

/** Как часто страница дела шлёт биение. */
export const BEAT_MS = 60 * 1000;

export type OpenEntry = { startedAt: Date; lastBeatAt: Date };

export function isStale(entry: OpenEntry, now: Date, idleMs: number = IDLE_MS): boolean {
  return now.getTime() - entry.lastBeatAt.getTime() > idleMs;
}

export function beatPatch(entry: OpenEntry, now: Date): { lastBeatAt: Date; seconds: number } {
  return {
    lastBeatAt: now,
    seconds: Math.max(0, Math.round((now.getTime() - entry.startedAt.getTime()) / 1000)),
  };
}

export function closePatch(entry: OpenEntry): { endedAt: Date; seconds: number } {
  return {
    endedAt: entry.lastBeatAt,
    seconds: Math.max(0, Math.round((entry.lastBeatAt.getTime() - entry.startedAt.getTime()) / 1000)),
  };
}

export function totalSeconds(entries: { seconds: number }[]): number {
  return entries.reduce((sum, e) => sum + e.seconds, 0);
}

/** «2 ч 14 мин», «9 мин», «—». Для показа в деле и в списке. */
export function formatHandled(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
}
