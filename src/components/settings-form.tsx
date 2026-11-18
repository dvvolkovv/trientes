"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePreferences } from "@/app/actions/settings";
import { useTranslations } from "next-intl";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/lib/locales";

const CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH", "DASH"];
const THEMES = ["light", "dark", "system"] as const;

/**
 * Значение темы в базе и его подпись на экране — разные вещи: значение
 * («dark») уходит в настройки, подпись читает человек и обязана быть на его
 * языке. Карта держит их рядом, чтобы новая тема не выехала английским словом.
 */
const THEME_LABEL_KEYS: Record<(typeof THEMES)[number], string> = {
  light: "themeLight",
  dark: "themeDark",
  system: "themeSystem",
};

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
  const t = useTranslations("common");

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
        <label className={labelCls}>{t("languageLabel")}</label>
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
        <label className={labelCls}>{t("currencyLabel")}</label>
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
        <label className={labelCls}>{t("themeLabel")}</label>
        <select
          className={fieldCls}
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          {THEMES.map((value) => (
            <option key={value} value={value}>
              {t(THEME_LABEL_KEYS[value])}
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
