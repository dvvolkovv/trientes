"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createCoinCard } from "@/app/actions/coin-card";
import { Field, inputCls, btnCls } from "./field";

export function StepBasics({
  onCreated,
}: {
  onCreated: (cardId: string, website: string) => void;
}) {
  const t = useTranslations("coinCard.wizard");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createCoinCard({ name, symbol, tagline, description, website });
          if (res.ok) onCreated(res.cardId, website);
          else setError(res.reason);
        });
      }}
    >
      <Field id="cc-name" label={t("name")}>
        <input id="cc-name" value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={100} className={inputCls} />
      </Field>
      <Field id="cc-symbol" label={t("symbol")} hint={t("symbolHint")}>
        <input id="cc-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)}
          required maxLength={12} placeholder="BTC" className={inputCls} />
      </Field>
      <Field id="cc-tagline" label={t("tagline")} hint={t("taglineHint")}>
        <input id="cc-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)}
          maxLength={120} className={inputCls} />
      </Field>
      <Field id="cc-website" label={t("website")}>
        <input id="cc-website" value={website} onChange={(e) => setWebsite(e.target.value)}
          required placeholder="example.org" className={inputCls} />
      </Field>
      <Field id="cc-desc" label={t("description")} hint={t("descriptionHint")}>
        <textarea id="cc-desc" value={description} onChange={(e) => setDescription(e.target.value)}
          rows={6} maxLength={20000} className={`${inputCls} min-h-[140px]`} />
      </Field>
      {error && <p className="text-down text-sm">{t(`errors.${error}`)}</p>}
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? t("saving") : t("next")}
      </button>
    </form>
  );
}
