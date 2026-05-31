"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { togglePriceAlert, deletePriceAlert } from "@/app/actions/price-alerts";

type Props = {
  id: string;
  coinId: string;
  symbol: string;
  op: "GTE" | "LTE";
  threshold: number;
  enabled: boolean;
  triggered: boolean;
  lastFiredAt: string | null;
  locale: string;
};

function fmt(n: number): string {
  return n >= 1 ? n.toFixed(2) : n.toPrecision(4);
}

export function AlertRow(props: Props) {
  const t = useTranslations("cabinet.alerts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const dir = props.op === "GTE" ? "≥" : "≤";

  return (
    <div className="flex items-center justify-between gap-3 border border-hairline rounded-md px-3 py-2.5">
      <Link
        href={`/${props.locale}/coin/${props.coinId}`}
        className="flex min-w-0 items-center gap-2 hover:underline"
      >
        <span className="font-semibold">{props.symbol}</span>
        <span className="text-muted">{dir}</span>
        <span className="font-medium">${fmt(props.threshold)}</span>
        {props.triggered ? (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/15 text-green-500">
            {t("triggered")}
          </span>
        ) : null}
        {!props.enabled ? (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-bg-tint text-muted">
            {t("paused")}
          </span>
        ) : null}
      </Link>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await togglePriceAlert(props.id, !props.enabled);
              router.refresh();
            })
          }
          className="text-xs px-2.5 py-1 rounded-md border border-hairline hover:bg-bg-tint disabled:opacity-50"
        >
          {props.enabled ? t("pause") : t("resume")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (!confirm(t("confirmDelete"))) return;
              await deletePriceAlert(props.id);
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
