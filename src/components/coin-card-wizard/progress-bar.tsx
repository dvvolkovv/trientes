"use client";

import { useTranslations } from "next-intl";

export function ProgressBar({ value, missing }: { value: number; missing: string[] }) {
  const t = useTranslations("coinCard.wizard");
  return (
    <div className="mb-8">
      <div className="flex justify-between items-baseline text-[12px] uppercase tracking-[0.15em] text-muted mb-2">
        <span>{t("filledPercent", { value })}</span>
        <span>{missing.length > 0 ? t("missingCount", { count: missing.length }) : t("complete")}</span>
      </div>
      <div className="h-1.5 w-full bg-background border border-hairline rounded-full overflow-hidden">
        <div
          className="h-full bg-accent glow-accent transition-all duration-500"
          style={{ width: `${value}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
