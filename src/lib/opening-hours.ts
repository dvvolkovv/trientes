/**
 * Часы работы точки продаж (слайс BN, ТЗ § 3.1).
 * Спека: `docs/superpowers/specs/2026-11-20-store-hours-category-returns-design.md`.
 *
 * Расписание хранится структурно, а не строкой, ровно потому, что к расписанию у
 * человека один вопрос — «открыто ли сейчас», — и на строке он не отвечается.
 *
 * Синтаксис OSM (`opening_hours`) мы **не разбираем**: в нём есть `PH`, `off`,
 * `sunrise`, месяцы и `week 1-53/2`, а частичный разбор ответит «закрыто» у
 * открытого места. У точки зеркала BTC Map остаётся прежний текст как есть.
 *
 * Функция `openStateAt` чистая и работает одинаково на сервере и в браузере:
 * местное время магазина берётся у платформы (`Intl.DateTimeFormat` с `timeZone`),
 * то есть летнее время считает она, а не мы.
 */

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

/** Промежуток «с … до …» в местном времени, минуты суток не пересчитываем в UTC. */
export type HourSpan = [string, string];

export type DayHours =
  | { kind: "closed" }
  | { kind: "allday" }
  | { kind: "open"; spans: HourSpan[] };

export type WeekHours = Partial<Record<WeekDay, DayHours>>;

/** Больше двух промежутков в сутках никому не нужно, а предел держит редактор под палец. */
export const MAX_SPANS_PER_DAY = 2;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(time: string): number | null {
  const m = TIME_RE.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * Разбор сохранённого в JSONB расписания. Негодная запись — это «расписания нет»,
 * а не исключение: строку в базе мог записать прежний вид кода, и падать на ней
 * значило бы уронить страницу точки из-за одного поля.
 *
 * День с пустым списком промежутков считается **закрытым**: «открыт, но не сказано
 * когда» — это обещание, которого расписание не даёт.
 */
export function parseWeekHours(raw: unknown): WeekHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const out: WeekHours = {};
  for (const day of WEEK_DAYS) {
    const value = row[day];
    if (!value || typeof value !== "object") continue;
    const kind = (value as { kind?: unknown }).kind;
    if (kind === "closed") {
      out[day] = { kind: "closed" };
      continue;
    }
    if (kind === "allday") {
      out[day] = { kind: "allday" };
      continue;
    }
    if (kind !== "open") continue;
    const rawSpans = (value as { spans?: unknown }).spans;
    if (!Array.isArray(rawSpans)) return null;
    const spans: HourSpan[] = [];
    for (const span of rawSpans.slice(0, MAX_SPANS_PER_DAY)) {
      if (!Array.isArray(span) || span.length !== 2) return null;
      const [from, to] = span;
      if (typeof from !== "string" || typeof to !== "string") return null;
      const a = minutesOf(from);
      const b = minutesOf(to);
      if (a === null || b === null) return null;
      // Одинаковые концы — промежуток нулевой длины; это ошибка ввода, а не ночь.
      if (a === b) continue;
      spans.push([from, to]);
    }
    out[day] = spans.length ? { kind: "open", spans } : { kind: "closed" };
  }
  return Object.keys(out).length ? out : null;
}

/** Расписание, из которого ничего не следует: ни одного открытого дня. */
export function isEmptyWeek(hours: WeekHours | null | undefined): boolean {
  if (!hours) return true;
  return !WEEK_DAYS.some((d) => {
    const day = hours[d];
    return day?.kind === "allday" || (day?.kind === "open" && day.spans.length > 0);
  });
}

export type OpenState = {
  /** Состояние посчитано. Нет пояса, нет расписания — `false`, и тогда остальных полей нет. */
  known: boolean;
  open?: boolean;
  /** До какого часа открыто. У круглосуточного дня пусто: он не закрывается. */
  until?: string;
  /** Когда откроется и в какой день недели. Закрыто всю неделю — пусто. */
  opensAt?: string;
  opensDay?: WeekDay;
  /** День недели в поясе магазина — он же подсвечивается в расписании. */
  today?: WeekDay;
};

/**
 * Местные день недели и минуты суток в поясе магазина. Негодный пояс отличаем от
 * верного здесь же: `Intl` на неизвестной зоне бросает, и это единственный способ
 * спросить платформу «знаешь такую?».
 */
function localNow(timezone: string, now: Date): { day: WeekDay; minutes: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase().slice(0, 3);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!weekday || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    const day = WEEK_DAYS.find((d) => d === weekday);
    if (!day) return null;
    // 24:00 у Intl означает полночь наступивших суток.
    return { day, minutes: (hour % 24) * 60 + minute };
  } catch {
    return null;
  }
}

function dayAt(hours: WeekHours, index: number): DayHours | undefined {
  return hours[WEEK_DAYS[((index % 7) + 7) % 7]];
}

/** Промежутки дня в минутах; конец меньше начала — промежуток уходит в следующие сутки. */
function spansOf(day: DayHours | undefined): { from: number; to: number }[] {
  if (!day) return [];
  if (day.kind === "allday") return [{ from: 0, to: 1440 }];
  if (day.kind !== "open") return [];
  const out: { from: number; to: number }[] = [];
  for (const [a, b] of day.spans) {
    const from = minutesOf(a);
    const to = minutesOf(b);
    if (from === null || to === null) continue;
    out.push({ from, to: to > from ? to : to + 1440 });
  }
  return out.sort((x, y) => x.from - y.from);
}

/**
 * Открыто ли сейчас и когда ближайшая перемена.
 *
 * Промежуток через полночь принадлежит дню, в котором начался: бар, работающий до
 * двух ночи, в два часа ночи **открыт**, и расписание обязано это сказать. Поэтому
 * текущие минуты сверяются и с сегодняшним днём, и с продолжением вчерашнего.
 */
export function openStateAt(
  hours: WeekHours | null | undefined,
  timezone: string | null | undefined,
  now: Date,
): OpenState {
  if (!hours || isEmptyWeek(hours)) return { known: false };
  if (!timezone) return { known: false };
  const local = localNow(timezone, now);
  if (!local) return { known: false };

  const todayIndex = WEEK_DAYS.indexOf(local.day);
  const minutes = local.minutes;

  // Сегодняшние промежутки плюс хвост вчерашнего, уехавший за полночь.
  const candidates: { from: number; to: number; allday: boolean }[] = [];
  for (const span of spansOf(dayAt(hours, todayIndex))) {
    candidates.push({ ...span, allday: dayAt(hours, todayIndex)?.kind === "allday" });
  }
  for (const span of spansOf(dayAt(hours, todayIndex - 1))) {
    if (span.to > 1440) candidates.push({ from: span.from - 1440, to: span.to - 1440, allday: false });
  }

  for (const span of candidates) {
    if (minutes >= span.from && minutes < span.to) {
      return {
        known: true,
        open: true,
        today: local.day,
        // Круглосуточный день не закрывается — обещать час закрытия нечем.
        ...(span.allday ? {} : { until: formatMinutes(span.to) }),
      };
    }
  }

  // Ближайшее открытие: сегодняшний остаток, затем вперёд по дням. Не больше семи:
  // заведение, закрытое всю неделю, получает честное «закрыто» без даты.
  for (let offset = 0; offset < 7; offset += 1) {
    const dayIndex = todayIndex + offset;
    for (const span of spansOf(dayAt(hours, dayIndex))) {
      if (offset === 0 && span.from <= minutes) continue;
      return {
        known: true,
        open: false,
        today: local.day,
        opensAt: formatMinutes(span.from),
        opensDay: WEEK_DAYS[((dayIndex % 7) + 7) % 7],
      };
    }
  }
  return { known: true, open: false, today: local.day };
}

/** Строка промежутка для показа: «09:00 — 18:00». */
export function formatSpan(span: HourSpan): string {
  return `${span[0]} — ${span[1]}`;
}

/** Пустая неделя для редактора: по умолчанию будни открыты, выходные закрыты. */
export function defaultWeek(): WeekHours {
  const out: WeekHours = {};
  for (const day of WEEK_DAYS) {
    out[day] = day === "sat" || day === "sun"
      ? { kind: "closed" }
      : { kind: "open", spans: [["09:00", "18:00"]] };
  }
  return out;
}
