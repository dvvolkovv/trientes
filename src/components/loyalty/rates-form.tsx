"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveBaseRate, saveCategoryRate } from "@/app/actions/loyalty";
import { PRODUCT_CATEGORIES } from "@/lib/products/categories";

/**
 * Ставки кэшбэка продавца: «на всё» и по категориям. Пустое поле снимает ставку — так
 * же, как пустая ставка в предложении товара значит «не обещаю», а не «ноль процентов».
 *
 * Рядом с категорией стоит число живых предложений: ставка, поставленная наугад, —
 * обещание неизвестно на что.
 */
export function CashbackRatesForm({
  companyId,
  base,
  byCategory,
  offerCounts,
}: {
  companyId: string;
  base: string;
  byCategory: Record<string, string>;
  offerCounts: Record<string, number>;
}) {
  const t = useTranslations("cabinetLoyalty");
  const tc = useTranslations("products.category");
  const router = useRouter();
  const [baseValue, setBaseValue] = useState(base);
  const [rates, setRates] = useState<Record<string, string>>(byCategory);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-24 bg-card border border-hairline rounded-md px-3 py-2 text-sm num";
  const button =
    "h-12 px-4 rounded-md border border-hairline text-sm shrink-0 hover:border-accent disabled:opacity-50";

  function run(key: string, fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setError(null);
    setSavedKey(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setSavedKey(key);
        router.refresh();
      } else {
        setError(r.reason ?? "failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-[12px] uppercase tracking-[0.14em] text-muted mb-2">{t("baseHeading")}</h2>
        <div className="flex items-center gap-2">
          <input
            value={baseValue}
            onChange={(e) => setBaseValue(e.target.value)}
            inputMode="decimal"
            placeholder="3"
            aria-label={t("baseHeading")}
            className={field}
          />
          <span className="text-sm text-muted">%</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("base", () => saveBaseRate(companyId, baseValue))}
            className={button}
          >
            {t("save")}
          </button>
          {savedKey === "base" ? <span className="text-[12px] text-accent">{t("saved")}</span> : null}
        </div>
        <p className="text-[11px] text-muted mt-2">{t("baseNote")}</p>
      </section>

      <section>
        <h2 className="text-[12px] uppercase tracking-[0.14em] text-muted mb-2">{t("categoriesHeading")}</h2>
        <ul className="flex flex-col gap-2">
          {PRODUCT_CATEGORIES.map((c) => (
            <li key={c} className="flex items-center gap-2 border border-hairline rounded-lg p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{tc(c)}</div>
                <div className="text-[11px] text-muted num">
                  {t("offersInCategory", { count: offerCounts[c] ?? 0 })}
                </div>
              </div>
              <input
                value={rates[c] ?? ""}
                onChange={(e) => setRates({ ...rates, [c]: e.target.value })}
                inputMode="decimal"
                placeholder="—"
                aria-label={tc(c)}
                className={field}
              />
              <span className="text-sm text-muted">%</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(c, () => saveCategoryRate(companyId, c, rates[c] ?? ""))}
                className={button}
              >
                {t("save")}
              </button>
              {savedKey === c ? <span className="text-[12px] text-accent">{t("saved")}</span> : null}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted mt-2">{t("categoriesNote")}</p>
      </section>

      {error ? <p className="text-[12px] text-red-400">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
