"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePreferences } from "@/app/actions/settings";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/lib/locales";

const CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"];
const THEMES = ["light", "dark", "system"];

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
const labelCls = "text-[12px] uppercase tracking-[0.15em] text-muted mb-2 block";

export function SettingsForm(props: {
  initialLocale: string;
  initialCurrency: string;
  initialTheme: string;
}) {
  const [locale, setLocale] = useState(props.initialLocale);
  const [currency, setCurrency] = useState(props.initialCurrency);
  const [theme, setTheme] = useState(props.initialTheme);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await updatePreferences({ locale, currency, theme });
          router.refresh();
        });
      }}
    >
      <div>
        <label className={labelCls}>Language</label>
        <select
          className={fieldCls}
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Currency</label>
        <select
          className={fieldCls}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Theme</label>
        <select
          className={fieldCls}
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full sm:w-auto bg-accent text-accent-foreground glow-accent rounded-md px-5 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all sm:self-start"
      >
        Save
      </button>
    </form>
  );
}
