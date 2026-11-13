import { getTranslations } from "next-intl/server";
import type { CirculatingView } from "@/lib/coin-card-circulating";
import { PROVENANCE_EPOCH } from "@/lib/coin-card-provenance";
import { ProvenanceBadge } from "./provenance-badge";

/**
 * «В обращении: 346 928 172 TAL» под ценой индекса — на месте, где прежде
 * стояли капитализация и полная оценка. Метка берётся не из провенанса, а из
 * того, прочитан ли выпуск сетью: провенанс не умеет понижать уровень доверия,
 * а здесь нужно именно текущее состояние.
 */
export async function CirculatingLine({
  view,
  symbol,
  at,
}: {
  view: CirculatingView | null;
  symbol: string;
  at: Date | string | null;
}) {
  const t = await getTranslations("coinCard.supply");
  if (!view) return null;

  const entry = {
    kind: view.verified ? ("AGGREGATED" as const) : ("SELF_REPORTED" as const),
    source: null,
    at: at ? new Date(at).toISOString() : PROVENANCE_EPOCH,
  };

  return (
    <div className="text-sm mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="num">
        {t("circulating")}:{" "}
        <strong>
          {new Intl.NumberFormat("en-US").format(Math.round(view.coins))} {symbol}
        </strong>
      </span>
      <ProvenanceBadge entry={entry} />
    </div>
  );
}
