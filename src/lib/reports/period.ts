/**
 * Период отчёта и сутки в часовом поясе предприятия (слайс CL, спека
 * `docs/superpowers/specs/2026-11-25-merchant-reports-accounting-design.md`, раздел 4).
 *
 * «Выручка за 25 ноября» зависит от пояса: сервер стоит в UTC, браузер — в поясе
 * смотрящего, и ни один из них не пояс магазина (разбор BN). Поэтому границы суток
 * считаются в названном поясе, а не в поясе процесса.
 */

export const REPORT_RANGES = ["today", "week", "month", "custom"] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

/** Период длиннее года запрещаем: это уже не отчёт, а выгрузка всей базы. */
export const MAX_PERIOD_DAYS = 366;

export type ResolvedPeriod = {
  range: ReportRange;
  /** Включительно, начало суток в поясе. */
  from: Date;
  /** Исключительно: начало суток, следующих за последним днём периода. */
  to: Date;
  /** Дни в виде `YYYY-MM-DD` — ими подписан экран и имя файла выгрузки. */
  fromDay: string;
  toDay: string;
  tz: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Смещение пояса в миллисекундах для данного мгновения. Платформа — единственный
 * судья: своя таблица правил летнего времени отстала бы в первый же перевод часов.
 */
function offsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour` в формате h23 отдаёт 24 для полуночи у части движков — приводим к нулю.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** Начало суток `YYYY-MM-DD` в поясе, выраженное мгновением UTC. */
export function zonedStartOfDay(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Два прохода: первое смещение берётся в точке-догадке, второе — в найденном
  // мгновении. Без второго прохода сутки перевода часов сдвигались бы на час.
  const first = guess - offsetMs(tz, new Date(guess));
  return new Date(guess - offsetMs(tz, new Date(first)));
}

/** День мгновения в поясе — ключ для разбивки «по дням». */
export function zonedDayKey(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function isRange(value: string | null | undefined): value is ReportRange {
  return typeof value === "string" && (REPORT_RANGES as readonly string[]).includes(value);
}

/**
 * Разбор периода из запроса. Негодные даты не отвергаются молчанием: `custom` без пары
 * годных дней читается как сегодняшний день, а не как «вся база» — пустой фильтр на
 * выгрузке был бы тихой выдачей всего.
 */
export function resolvePeriod(input: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  tz: string;
  now?: Date;
}): ResolvedPeriod {
  const tz = input.tz;
  const now = input.now ?? new Date();
  const today = zonedDayKey(now, tz);

  let range: ReportRange = isRange(input.range) ? input.range : "today";
  let fromDay = today;
  let toDay = today;

  if (range === "week") fromDay = shiftDay(today, -6);
  else if (range === "month") fromDay = shiftDay(today, -29);
  else if (range === "custom") {
    const a = input.from?.trim() ?? "";
    const b = input.to?.trim() ?? "";
    if (DAY_RE.test(a) && DAY_RE.test(b)) {
      fromDay = a <= b ? a : b;
      toDay = a <= b ? b : a;
    } else if (DAY_RE.test(a)) {
      fromDay = a;
      toDay = a > today ? a : today;
    } else {
      // Пара дней не набрана — честно сегодня, и форма это покажет.
      range = "today";
    }
  }

  // Потолок: лишнее отрезается от начала, конец периода человек назвал сам.
  const from0 = zonedStartOfDay(fromDay, tz);
  const to0 = zonedStartOfDay(shiftDay(toDay, 1), tz);
  if (to0.getTime() - from0.getTime() > MAX_PERIOD_DAYS * 24 * 3600 * 1000) {
    fromDay = shiftDay(toDay, -(MAX_PERIOD_DAYS - 1));
  }

  return {
    range,
    from: zonedStartOfDay(fromDay, tz),
    to: zonedStartOfDay(shiftDay(toDay, 1), tz),
    fromDay,
    toDay,
    tz,
  };
}
