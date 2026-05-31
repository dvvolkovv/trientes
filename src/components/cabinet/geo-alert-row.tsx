"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toggleGeoAlert, deleteGeoAlert } from "@/app/actions/geo-alerts";

type Props = {
  id: string;
  countryCode: string;
  enabled: boolean;
  notifyFintech: boolean;
  notifyPoints: boolean;
};

export function GeoAlertRow({ id, countryCode, enabled, notifyFintech, notifyPoints }: Props) {
  const t = useTranslations("cabinet.geoAlerts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const tags: string[] = [];
  if (notifyFintech) tags.push(t("notifyFintech"));
  if (notifyPoints) tags.push(t("notifyPoints"));

  return (
    <div className="flex items-center justify-between gap-3 border border-hairline rounded-md px-3 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-semibold text-base">{countryCode}</span>
        <span className="text-xs text-muted">{tags.join(" · ")}</span>
        {!enabled ? (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-bg-tint text-muted">
            {t("paused")}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await toggleGeoAlert(id, !enabled);
              router.refresh();
            })
          }
          className="text-xs px-2.5 py-1 rounded-md border border-hairline hover:bg-bg-tint disabled:opacity-50"
        >
          {enabled ? t("pause") : t("resume")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (!confirm(t("confirmDelete"))) return;
              await deleteGeoAlert(id);
              router.refresh();
            })
          }
          className="text-xs px-2.5 py-1 rounded-md border border-hairline text-red-500 hover:bg-red-500/10 disabled:opacity-50"
        >
          {t("delete")}
        </button>
      </div>
    </div>
  );
}
