"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { deleteOffer, saveOffer, setOfferStatus } from "@/app/actions/offers";
import { OFFER_CURRENCIES, OFFER_UNITS } from "@/lib/products/offers-rules";

export type OfferInitial = {
  price: string;
  currency: string;
  unit: string;
  cashbackPercent: string;
  saleRules: string;
  onlineUrl: string;
  status: "ACTIVE" | "PAUSED";
  exists: boolean;
};

/**
 * «Моё предложение» — цена, единица, ставка кэшбэка и правила продажи. Живёт на той же
 * странице, где правится паспорт: два экрана на одну вещь — две двери, через которые
 * данные расходятся.
 */
export function OfferForm({
  companyId,
  productId,
  initial,
}: {
  companyId: string;
  productId: string;
  initial: OfferInitial;
}) {
  const t = useTranslations("offers");
  const router = useRouter();
  const [price, setPrice] = useState(initial.price);
  const [currency, setCurrency] = useState(initial.currency);
  const [unit, setUnit] = useState(initial.unit);
  const [cashback, setCashback] = useState(initial.cashbackPercent);
  const [rules, setRules] = useState(initial.saleRules);
  const [url, setUrl] = useState(initial.onlineUrl);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";

  function run(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(r.reason ?? "failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block space-y-1">
          <span className={label}>{t("price")}</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={`${field} num`} />
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("currency")}</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
            {OFFER_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("unit")}</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={field}>
            {OFFER_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`units.${u}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("cashback")}</span>
          <input
            value={cashback}
            onChange={(e) => setCashback(e.target.value)}
            inputMode="decimal"
            placeholder="—"
            className={`${field} num`}
          />
        </label>
      </div>

      {/* Ставка — обещание продавца, а не наша выплата: кошелька и эквайринга ещё нет. */}
      <p className="text-[11px] text-muted">{t("cashbackNote")}</p>

      <label className="block space-y-1">
        <span className={label}>{t("onlineUrl")}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={field} />
      </label>

      <label className="block space-y-1">
        <span className={label}>{t("saleRules")}</span>
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={3} maxLength={2000} className={field} />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() =>
              saveOffer(companyId, productId, {
                price,
                currency,
                unit,
                cashbackPercent: cashback,
                onlineUrl: url,
                saleRules: rules,
              }),
            )
          }
          className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {initial.exists ? t("save") : t("publish")}
        </button>

        {initial.exists ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => setOfferStatus(companyId, productId, initial.status === "ACTIVE" ? "PAUSED" : "ACTIVE"))
              }
              className="h-12 px-4 rounded-md border border-hairline text-sm disabled:opacity-50"
            >
              {initial.status === "ACTIVE" ? t("pause") : t("resume")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteOffer(companyId, productId))}
              className="h-12 px-4 rounded-md border border-hairline text-sm text-red-500 disabled:opacity-50"
            >
              {t("remove")}
            </button>
          </>
        ) : null}
      </div>

      {initial.exists && initial.status === "PAUSED" ? <p className="text-[12px] text-muted">{t("pausedNote")}</p> : null}
      {saved ? <p className="text-[13px] text-accent">{t("saved")}</p> : null}
      {error ? <p className="text-[13px] text-red-500">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
