"use client";

import Link from "next/link";
import type { ReportRange } from "@/lib/reports/period";

/**
 * Выбор периода отчёта (слайс CL). Готовые отрезки — ссылки, свой период — обычная
 * форма `GET`: состояние периода живёт в адресе страницы, поэтому его можно сохранить
 * в закладках и переслать бухгалтеру.
 */
export function ReportPeriodForm({
  basePath,
  range,
  fromDay,
  toDay,
  labels,
}: {
  basePath: string;
  range: ReportRange;
  fromDay: string;
  toDay: string;
  labels: { ranges: Record<ReportRange, string>; from: string; to: string; apply: string };
}) {
  // Высота 44 px — порог пальца (правило AN): период выбирают с телефона у прилавка.
  const chip =
    "flex h-11 items-center justify-center rounded-[12px] border px-4 text-[13px] font-medium transition-colors";
  const field = "h-11 min-w-0 flex-1 rounded-[12px] border border-hairline bg-card px-3 text-[13px] num";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(["today", "week", "month"] as const).map((key) => (
          <Link
            key={key}
            href={`${basePath}?range=${key}`}
            className={`${chip} ${
              range === key ? "border-accent bg-accent/10 text-foreground" : "border-hairline bg-card text-muted"
            }`}
          >
            {labels.ranges[key]}
          </Link>
        ))}
      </div>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="range" value="custom" />
        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className="text-[11.5px] text-muted">{labels.from}</span>
          <input className={field} type="date" name="from" defaultValue={fromDay} />
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className="text-[11.5px] text-muted">{labels.to}</span>
          <input className={field} type="date" name="to" defaultValue={toDay} />
        </label>
        <button type="submit" className={`${chip} border-hairline bg-card text-foreground hover:border-accent`}>
          {labels.apply}
        </button>
      </form>
    </div>
  );
}
