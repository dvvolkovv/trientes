"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { submitCoinRequest } from "@/app/actions/coin-request";

const inputCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
const labelCls = "text-[12px] uppercase tracking-[0.15em] text-muted mb-2 block";

export function CoinRequestForm() {
  const t = useTranslations("request");
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [coingeckoId, setCoingeckoId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await submitCoinRequest({ name, symbol, coingeckoId, reason });
          if (res.ok) {
            setDone(true);
            setName("");
            setSymbol("");
            setCoingeckoId("");
            setReason("");
            router.refresh();
          } else {
            setError(res.reason ?? "unknown_error");
          }
        });
      }}
    >
      <div>
        <label htmlFor="rq-name" className={labelCls}>
          {t("name")}
        </label>
        <input
          id="rq-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="rq-symbol" className={labelCls}>
          {t("symbol")}
        </label>
        <input
          id="rq-symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required
          maxLength={12}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="rq-cg" className={labelCls}>
          {t("coingeckoIdOptional")}
        </label>
        <input
          id="rq-cg"
          value={coingeckoId}
          onChange={(e) => setCoingeckoId(e.target.value)}
          placeholder="e.g. bitcoin"
          maxLength={80}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="rq-reason" className={labelCls}>
          {t("reason")}
        </label>
        <textarea
          id="rq-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={5}
          maxLength={2000}
          rows={4}
          className={`${inputCls} min-h-[120px]`}
        />
      </div>
      {error && <p className="text-down text-sm mt-2">{t(`errors.${error}`)}</p>}
      {done && <p className="text-up text-sm mt-2">{t("submitted")}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full sm:w-auto bg-accent text-accent-foreground glow-accent rounded-md px-5 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
