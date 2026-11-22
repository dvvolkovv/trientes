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
import { CardOpenBadge } from "@/components/company-card/open-badge";
import { WEEK_DAYS, isEmptyWeek, openStateAt, type WeekHours } from "@/lib/opening-hours";

export function PoiHours({
  hours,
  timezone,
  fallbackText,
  note,
  title,
}: {
  hours?: WeekHours | null;
  timezone?: string | null;
  /** Текст точки зеркала BTC Map: синтаксис OSM мы не разбираем. */
  fallbackText?: string | null;
  /**
   * Чьё это расписание (слайс BX). У точки без своих часов показываются часы
   * конторы, а это не часы торговли — и сказать об этом надо словами, иначе
   * покупатель поедет к закрытой двери, уверенный, что мы обещали открытую.
   */
  note?: string | null;
  /** Подпись раздела: состояние стоит с ней на одной строке (просьба владельца, BY). */
  title?: string;
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
        {/* Заголовок слева, состояние справа на той же строке: закрыто красным,
            открыто зелёным (решение владельца, слайс BY). Прежде «закрыто» было
            серым и терялось в списке дней. */}
        <div className="flex items-center justify-between gap-2">
          {title ? <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{title}</span> : <span />}
          <CardOpenBadge state={state} />
        </div>
        {note ? <div className="text-[11px] text-muted">{note}</div> : null}
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
