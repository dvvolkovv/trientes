"use client";

/**
 * Редактор часов работы точки (слайс BN).
 *
 * Семь строк в ширину экрана: день, три состояния плитками, промежутки полями
 * `type="time"`. Кнопка «как в первый рабочий день» заполняет остальные дни —
 * семь раз вводить одно и то же пальцем это и есть жалоба BM о «тяжёлом дизайне».
 */

import { useTranslations } from "next-intl";
import {
  MAX_SPANS_PER_DAY,
  WEEK_DAYS,
  type DayHours,
  type WeekDay,
  type WeekHours,
} from "@/lib/opening-hours";
import { allTimezones } from "@/lib/timezones";

const KINDS = ["open", "allday", "closed"] as const;

function dayOf(hours: WeekHours, day: WeekDay): DayHours {
  return hours[day] ?? { kind: "closed" };
}

export function HoursEditor({
  value,
  timezone,
  onChange,
  onTimezoneChange,
}: {
  value: WeekHours;
  timezone: string;
  onChange: (next: WeekHours) => void;
  onTimezoneChange: (next: string) => void;
}) {
  const t = useTranslations("business.hours");

  function setDay(day: WeekDay, next: DayHours) {
    onChange({ ...value, [day]: next });
  }

  function setKind(day: WeekDay, kind: (typeof KINDS)[number]) {
    if (kind === "open") {
      const current = dayOf(value, day);
      const spans = current.kind === "open" && current.spans.length ? current.spans : [["09:00", "18:00"] as [string, string]];
      setDay(day, { kind: "open", spans });
      return;
    }
    setDay(day, { kind });
  }

  function setSpan(day: WeekDay, index: number, side: 0 | 1, time: string) {
    const current = dayOf(value, day);
    if (current.kind !== "open") return;
    const spans = current.spans.map((s) => [...s] as [string, string]);
    spans[index][side] = time;
    setDay(day, { kind: "open", spans });
  }

  function addSpan(day: WeekDay) {
    const current = dayOf(value, day);
    if (current.kind !== "open" || current.spans.length >= MAX_SPANS_PER_DAY) return;
    setDay(day, { kind: "open", spans: [...current.spans, ["14:00", "18:00"]] });
  }

  function removeSpan(day: WeekDay, index: number) {
    const current = dayOf(value, day);
    if (current.kind !== "open") return;
    const spans = current.spans.filter((_, i) => i !== index);
    setDay(day, spans.length ? { kind: "open", spans } : { kind: "closed" });
  }

  /** Первый день, у которого есть что копировать: обычно понедельник. */
  const sourceDay = WEEK_DAYS.find((d) => dayOf(value, d).kind === "open") ?? "mon";

  function copyToAll() {
    const source = dayOf(value, sourceDay);
    const next: WeekHours = { ...value };
    for (const day of WEEK_DAYS) {
      if (day === "sat" || day === "sun") continue;
      next[day] = source.kind === "open" ? { kind: "open", spans: source.spans.map((s) => [...s] as [string, string]) } : source;
    }
    onChange(next);
  }

  const timeInput = "bg-bg-tint border border-hairline rounded-md px-2 py-1.5 text-[13px] num";

  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-muted">{t("title")}</div>

      <div className="space-y-1.5">
        {WEEK_DAYS.map((day) => {
          const current = dayOf(value, day);
          return (
            <div key={day} className="rounded-[14px] border border-hairline bg-card p-2">
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[12.5px] font-semibold">{t(`day.${day}`)}</span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setKind(day, kind)}
                      aria-pressed={current.kind === kind}
                      className={`min-h-[34px] rounded-[10px] border px-2.5 text-[11.5px] ${
                        current.kind === kind
                          ? "border-accent bg-accent/10"
                          : "border-hairline bg-bg-tint hover:border-accent/50"
                      }`}
                    >
                      {t(`kind.${kind}`)}
                    </button>
                  ))}
                </div>
              </div>

              {current.kind === "open" && (
                <div className="mt-2 space-y-1.5">
                  {current.spans.map((span, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        type="time"
                        value={span[0]}
                        onChange={(e) => setSpan(day, i, 0, e.target.value)}
                        aria-label={t("from")}
                        className={timeInput}
                      />
                      <span className="text-muted">—</span>
                      <input
                        type="time"
                        value={span[1]}
                        onChange={(e) => setSpan(day, i, 1, e.target.value)}
                        aria-label={t("to")}
                        className={timeInput}
                      />
                      {current.spans.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSpan(day, i)}
                          aria-label={t("removeSpan")}
                          className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-[13px] text-muted hover:bg-bg-tint"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {current.spans.length < MAX_SPANS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => addSpan(day)}
                      className="text-[11.5px] text-accent underline-offset-2 hover:underline"
                    >
                      + {t("addSpan")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={copyToAll}
        className="min-h-[40px] w-full rounded-[12px] border border-hairline bg-bg-tint text-[12.5px] hover:border-accent/50"
      >
        {t("copyToWeekdays", { day: t(`day.${sourceDay}`) })}
      </button>

      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wider text-muted">{t("timezone")}</span>
        <select
          value={timezone}
          onChange={(e) => onTimezoneChange(e.target.value)}
          className="w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]"
        >
          <option value="">{t("timezonePick")}</option>
          {allTimezones().map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
        {/* Без пояса расписание остаётся видно, а «открыто сейчас» не считается:
            неверное «закрыто» отправит человека мимо открытой двери. */}
        <span className="block text-[11px] leading-snug text-muted">{t("timezoneHint")}</span>
      </label>
    </div>
  );
}
