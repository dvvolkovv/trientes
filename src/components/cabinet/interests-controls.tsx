"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { INTEREST_KEYS, type InterestKey } from "@/lib/interests";
import { setInterest, saveRouteRadii } from "@/app/actions/interests";

type Verdict = "LIKE" | "DISLIKE" | "NONE";

/**
 * Три состояния одной строки. «Молчу» — середина, и она не лишняя: снять «не нравится»
 * иначе было бы можно только сказав «нравится», то есть человек не мог бы вернуть
 * интерес в то состояние, в котором он был до его отметок.
 */
export function InterestsControls({
  marks,
  corridor,
  alert,
}: {
  marks: Record<string, Verdict>;
  corridor: number;
  alert: number;
}) {
  const t = useTranslations("cabinetInterests");
  const [rows, setRows] = useState<Record<string, Verdict>>(marks);
  const [corridorValue, setCorridorValue] = useState(String(corridor));
  const [alertValue, setAlertValue] = useState(String(alert));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pick(key: InterestKey, verdict: Verdict) {
    setRows((prev) => ({ ...prev, [key]: verdict }));
    start(async () => {
      await setInterest(key, verdict === "NONE" ? null : verdict);
    });
  }

  const pill = (active: boolean) =>
    `h-12 px-3 rounded-md border text-sm min-w-[84px] ${
      active ? "border-accent text-accent" : "border-hairline text-muted hover:border-accent"
    }`;

  return (
    <div className="space-y-5">
      <ul className="space-y-2">
        {INTEREST_KEYS.map((key) => {
          const current = rows[key] ?? "NONE";
          return (
            <li
              key={key}
              className="border border-hairline rounded-md px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap"
            >
              <span className="text-sm font-medium">{t(`axis.${key}`)}</span>
              <div className="flex gap-2">
                <button type="button" className={pill(current === "LIKE")} onClick={() => pick(key, "LIKE")}>
                  {t("like")}
                </button>
                <button type="button" className={pill(current === "NONE")} onClick={() => pick(key, "NONE")}>
                  {t("neutral")}
                </button>
                <button type="button" className={pill(current === "DISLIKE")} onClick={() => pick(key, "DISLIKE")}>
                  {t("dislike")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-muted">{t("axisNote")}</p>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setSaved(false);
          start(async () => {
            const res = await saveRouteRadii({ corridor: corridorValue, alert: alertValue });
            if (res.ok) setSaved(true);
            else setError(t(`errors.${res.reason}`));
          });
        }}
      >
        <label className="block text-sm">
          <span className="block mb-1">{t("corridor")}</span>
          <input
            className="w-full h-12 px-3 bg-transparent border border-hairline rounded-md text-sm"
            value={corridorValue}
            onChange={(e) => setCorridorValue(e.target.value)}
            inputMode="numeric"
          />
          <span className="block mt-1 text-[12px] text-muted">{t("corridorHint")}</span>
        </label>
        <label className="block text-sm">
          <span className="block mb-1">{t("alert")}</span>
          <input
            className="w-full h-12 px-3 bg-transparent border border-hairline rounded-md text-sm"
            value={alertValue}
            onChange={(e) => setAlertValue(e.target.value)}
            inputMode="numeric"
          />
          <span className="block mt-1 text-[12px] text-muted">{t("alertHint")}</span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-12 w-full rounded-md border border-hairline text-sm hover:border-accent disabled:opacity-50"
        >
          {t("save")}
        </button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {saved && !error ? <p className="text-sm text-muted">{t("saved")}</p> : null}
      </form>
    </div>
  );
}
