"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createGeoAlert } from "@/app/actions/geo-alerts";

export function CreateGeoAlertForm() {
  const t = useTranslations("cabinet.geoAlerts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cc, setCc] = useState("");
  const [fintech, setFintech] = useState(true);
  const [points, setPoints] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createGeoAlert({ countryCode: cc, notifyFintech: fintech, notifyPoints: points });
          if (r.ok) {
            setCc("");
            router.refresh();
          } else {
            setError(r.reason);
          }
        });
      }}
      className="border border-hairline rounded-md p-3 space-y-3 bg-card-alt"
    >
      <div className="flex gap-2 items-stretch">
        <input
          value={cc}
          onChange={(e) => setCc(e.target.value.toUpperCase().slice(0, 2))}
          placeholder={t("countryPlaceholder")}
          maxLength={2}
          className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm w-24 uppercase tracking-wider"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={fintech} onChange={(e) => setFintech(e.target.checked)} />
          {t("notifyFintech")}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={points} onChange={(e) => setPoints(e.target.checked)} />
          {t("notifyPoints")}
        </label>
        <button
          type="submit"
          disabled={pending || cc.length !== 2}
          className="ml-auto px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </div>
      {error ? <p className="text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
    </form>
  );
}
