"use client";

import { useState, useTransition } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createExchange } from "@/app/actions/exchange";
import type { ExchangeProfileInput } from "@/lib/exchange";

type FormState = {
  legalName: string;
  displayName: string;
  website: string;
  country: string;
  email: string;
  description: string;
  phone: string;
  address: string;
  logoUrl: string;
};

const EMPTY: FormState = {
  legalName: "",
  displayName: "",
  website: "",
  country: "",
  email: "",
  description: "",
  phone: "",
  address: "",
  logoUrl: "",
};

const REQUIRED_KEYS = ["legalName", "displayName", "website", "country", "email"] as const;

export function CreateExchangeForm() {
  const t = useTranslations("exchange");
  const tCab = useTranslations("cabinet.exchanges");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const set =
    (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createExchange(form as ExchangeProfileInput);
          if (r.ok) router.push(`/${locale}/cabinet/exchanges/${r.id}`);
          else setError(r.reason);
        });
      }}
    >
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{tCab("add")}</h3>
      {REQUIRED_KEYS.map((k) => (
        <input
          key={k}
          value={form[k]}
          onChange={set(k)}
          placeholder={t(k)}
          required
          className="w-full px-3 py-2 rounded-md border border-hairline bg-card"
        />
      ))}
      <textarea
        value={form.description}
        onChange={set("description")}
        placeholder={t("description")}
        rows={3}
        className="w-full px-3 py-2 rounded-md border border-hairline bg-card"
      />
      {(["phone", "address", "logoUrl"] as const).map((k) => (
        <input
          key={k}
          value={form[k]}
          onChange={set(k)}
          placeholder={t(k)}
          className="w-full px-3 py-2 rounded-md border border-hairline bg-card"
        />
      ))}
      {error && <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 rounded-md bg-blue text-blue-foreground font-medium disabled:opacity-50"
      >
        {pending ? tCab("submitting") : tCab("submit")}
      </button>
    </form>
  );
}
