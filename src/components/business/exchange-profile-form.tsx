"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveExchangeProfile } from "@/app/actions/exchange";
import type { ExchangeProfileInput } from "@/lib/exchange";

type Initial = {
  legalName: string;
  displayName: string;
  description: string;
  website: string;
  country: string;
  email: string;
  phone: string;
  address: string;
  logoUrl: string;
};

const TEXT_KEYS = ["legalName", "displayName", "website", "country", "email", "phone", "address", "logoUrl"] as const;

export function ExchangeProfileForm({
  exchangeId,
  initial,
}: { exchangeId: string; initial: Initial }) {
  const t = useTranslations("exchange");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<Initial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onChange =
    (k: keyof Initial) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((s) => ({ ...s, [k]: e.target.value }));
      setSaved(false);
    };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await saveExchangeProfile(exchangeId, form as ExchangeProfileInput);
          if (r.ok) {
            setSaved(true);
            router.refresh();
          } else {
            setError(r.reason);
          }
        });
      }}
    >
      {TEXT_KEYS.map((k) => (
        <label key={k} className="block">
          <span className="text-xs uppercase tracking-wider text-muted">{t(k)}</span>
          <input
            value={form[k]}
            onChange={onChange(k)}
            className="mt-1 w-full px-3 py-2 rounded-md border border-hairline bg-card"
          />
        </label>
      ))}
      <label className="block">
        <span className="text-xs uppercase tracking-wider text-muted">{t("description")}</span>
        <textarea
          value={form.description}
          onChange={onChange("description")}
          rows={4}
          className="mt-1 w-full px-3 py-2 rounded-md border border-hairline bg-card"
        />
      </label>
      {error && <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p>}
      {saved && <p className="text-green-500 text-sm">{t("saved")}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 rounded-md bg-blue text-blue-foreground font-medium disabled:opacity-50"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
