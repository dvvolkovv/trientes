"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { rateCoin } from "@/app/actions/ratings";
import { MAX_STARS, filledStars, type RatingSummary } from "@/lib/ratings";

/**
 * Оценка монеты звёздами. Одна и та же шкала показывает два разных числа, и
 * путать их нельзя: пока посетитель не оценивал, закрашена **средняя** оценка
 * (приглушённо), а как только он поставил свою — видна **его** оценка цветом
 * выделения. Средняя при этом не исчезает: она стоит рядом цифрами, и это
 * точный ответ, тогда как звёзды целые.
 */
export function RatingStars({
  coinKey,
  initial,
  isAuthed,
  locale,
}: {
  coinKey: string;
  initial: RatingSummary;
  isAuthed: boolean;
  locale: string;
}) {
  const t = useTranslations("rating");
  const router = useRouter();
  const [summary, setSummary] = useState<RatingSummary>(initial);
  const [hover, setHover] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const mine = summary.mine;
  const shown = hover ?? mine ?? filledStars(summary.average);
  // Свой голос — цветом выделения, чужая средняя — приглушённо: это разные
  // утверждения, и одинаковый цвет выдавал бы среднюю за личную оценку.
  const litClass = hover !== null || mine !== null ? "text-accent" : "text-muted-strong";

  const send = (value: number) => {
    if (!isAuthed) {
      router.push(`/${locale}/login`);
      return;
    }
    start(async () => {
      const res = await rateCoin(coinKey, value);
      if (res.ok) setSummary(res.summary);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div
        className={`flex items-center gap-1 ${pending ? "opacity-50" : ""}`}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: MAX_STARS }, (_, i) => i + 1).map((value) => {
          const lit = value <= shown;
          // Нажатие на свою же звезду снимает оценку: промах пальцем не должен
          // оставаться в средней навсегда.
          const label =
            mine === value ? t("clearLabel") : t("rateLabel", { stars: value });
          return (
            <button
              key={value}
              type="button"
              aria-label={label}
              title={label}
              disabled={pending}
              onMouseEnter={() => setHover(value)}
              onFocus={() => setHover(value)}
              onBlur={() => setHover(null)}
              onClick={() => send(value)}
              className={`transition-colors ${lit ? litClass : "text-hairline hover:text-muted"}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill={lit ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7"
                aria-hidden="true"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          );
        })}
      </div>
      {summary.average !== null ? (
        <div className="flex items-baseline gap-2">
          <span className="num text-[22px] font-medium">
            {summary.average.toFixed(1)}
          </span>
          <span className="num text-[12px] text-muted">
            {t("countLabel", { count: summary.count })}
          </span>
        </div>
      ) : (
        <span className="text-[13px] text-muted">{t("none")}</span>
      )}
      <span className="text-[13px] text-muted">
        {!isAuthed ? t("signIn") : mine !== null ? t("yours", { stars: mine }) : t("hint")}
      </span>
    </div>
  );
}
