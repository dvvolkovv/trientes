/**
 * Показ часов работы (слайс BN). Серверный компонент: состояние считается на
 * каждый запрос, и это верно — страница точки динамическая.
 *
 * Состояние показывается только когда его есть на чём считать: нет расписания или
 * нет пояса — остаётся само расписание (или прежний текст точки зеркала BTC Map).
 */

import { getTranslations } from "next-intl/server";
import {
  WEEK_DAYS,
  isEmptyWeek,
  openStateAt,
  parseWeekHours,
  type WeekHours,
} from "@/lib/opening-hours";

export async function OpenBadge({
  hours,
  timezone,
  now = new Date(),
}: {
  hours: WeekHours | null;
  timezone: string | null;
  now?: Date;
}) {
  const t = await getTranslations("business.hours");
  const state = openStateAt(hours, timezone, now);
  if (!state.known) return null;
  const tone = state.open
    ? "border-[#30B658]/40 bg-[#30B658]/10 text-[#30B658]"
    : "border-hairline bg-bg-tint text-muted";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${tone}`}>
      {state.open ? t("openNow") : t("closedNow")}
      {state.open && state.until ? ` · ${t("until", { time: state.until })}` : ""}
      {!state.open && state.opensAt
        ? ` · ${t("opensAt", { time: state.opensAt, day: t(`dayShort.${state.opensDay}`) })}`
        : ""}
    </span>
  );
}

export async function HoursTable({
  hours,
  timezone,
  fallbackText,
  now = new Date(),
}: {
  hours: WeekHours | null;
  timezone: string | null;
  /** Текст часов точки зеркала BTC Map: разбирать синтаксис OSM мы не берёмся. */
  fallbackText?: string | null;
  now?: Date;
}) {
  const t = await getTranslations("business.hours");
  if (!hours || isEmptyWeek(hours)) {
    return fallbackText ? <div className="text-[12.5px] text-muted">{fallbackText}</div> : null;
  }
  const state = openStateAt(hours, timezone, now);
  return (
    <div className="space-y-0.5">
      {WEEK_DAYS.map((day) => {
        const d = hours[day] ?? { kind: "closed" as const };
        const today = state.today === day;
        return (
          <div
            key={day}
            className={`flex items-baseline justify-between gap-3 text-[12.5px] ${today ? "font-semibold" : "text-muted"}`}
          >
            <span>{t(`day.${day}`)}</span>
            <span className="num text-right">
              {d.kind === "allday"
                ? t("kind.allday")
                : d.kind === "closed"
                  ? t("kind.closed")
                  : d.spans.map((s) => `${s[0]}–${s[1]}`).join(", ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Удобство для серверных страниц: разбор JSONB и показ одной строкой. */
export function weekFrom(raw: unknown): WeekHours | null {
  return parseWeekHours(raw);
}
