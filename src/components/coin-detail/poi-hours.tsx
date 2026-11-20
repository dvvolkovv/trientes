"use client";

/**
 * Часы работы в карточке точки навигатора (слайс BN).
 *
 * Своя клиентская сборка, а не `hours-view.tsx`: карточку рисует браузер, и
 * состояние «открыто сейчас» должно считаться у него — у сервера свой момент
 * времени, и закэшированное «открыто» соврало бы через час. Правило одно на обе
 * сборки (`openStateAt`), расходиться им нечем.
 */

import { useTranslations } from "next-intl";
import { WEEK_DAYS, isEmptyWeek, openStateAt, type WeekHours } from "@/lib/opening-hours";

export function PoiHours({
  hours,
  timezone,
  fallbackText,
}: {
  hours?: WeekHours | null;
  timezone?: string | null;
  /** Текст точки зеркала BTC Map: синтаксис OSM мы не разбираем. */
  fallbackText?: string | null;
}) {
  const t = useTranslations("business.hours");
  const week = hours && !isEmptyWeek(hours) ? hours : null;
  if (!week) {
    if (!fallbackText) return null;
    return (
      <div className="flex gap-2 text-[13px] leading-snug">
        <span aria-hidden className="w-5 shrink-0 text-center text-muted">🕒</span>
        <span className="flex-1">{fallbackText}</span>
      </div>
    );
  }

  const state = openStateAt(week, timezone ?? null, new Date());

  return (
    <div className="flex gap-2 text-[13px] leading-snug">
      <span aria-hidden className="w-5 shrink-0 text-center text-muted">🕒</span>
      <div className="flex-1 space-y-1">
        {state.known ? (
          <div className={state.open ? "font-semibold text-[#30B658]" : "font-semibold text-muted"}>
            {state.open ? t("openNow") : t("closedNow")}
            {state.open && state.until ? ` · ${t("until", { time: state.until })}` : ""}
            {!state.open && state.opensAt
              ? ` · ${t("opensAt", { time: state.opensAt, day: t(`dayShort.${state.opensDay}`) })}`
              : ""}
          </div>
        ) : null}
        <div className="space-y-0.5">
          {WEEK_DAYS.map((day) => {
            const d = week[day] ?? { kind: "closed" as const };
            const today = state.today === day;
            return (
              <div
                key={day}
                className={`flex items-baseline justify-between gap-3 text-[12px] ${today ? "" : "text-muted"}`}
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
      </div>
    </div>
  );
}
