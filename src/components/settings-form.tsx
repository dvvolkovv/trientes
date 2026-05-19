"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updatePreferences } from "@/app/actions/settings";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/lib/locales";

const CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"];
const THEMES = ["light", "dark", "system"];

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
        <Label>Language</Label>
        <select
          className="border rounded p-2 w-full"
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
        <Label>Currency</Label>
        <select
          className="border rounded p-2 w-full"
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
        <Label>Theme</Label>
        <select
          className="border rounded p-2 w-full"
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
      <Button disabled={pending} type="submit">
        Save
      </Button>
    </form>
  );
}
