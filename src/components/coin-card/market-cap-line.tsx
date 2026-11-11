import { getTranslations } from "next-intl/server";
import { formatCompact } from "@/lib/format";
import { ProvenanceBadge } from "./provenance-badge";

/**
 * Капитализация и FDV под ценой индекса. Знак доллара ставит `formatCompact`,
 * и второй здесь не нужен: карточка показывала «$ $4.16T». Метка берётся не из провенанса, а из
 * `supplySource` самого индекса: провенанс не умеет понижать уровень доверия
 * (и правильно, что не умеет), а здесь нужно именно текущее состояние — по
 * проверенному выпуску посчитано или по словам проекта.
 */
export async function MarketCapLine({
  marketCapUsd,
  fdvUsd,
  supplySource,
  computedAt,
}: {
  marketCapUsd: number | null;
  fdvUsd: number | null;
  supplySource: string | null;
  computedAt: Date | string;
}) {
  const t = await getTranslations("coinCard.supply");
  if (marketCapUsd == null) return null;

  const entry = {
    kind: supplySource === "ONCHAIN" ? ("AGGREGATED" as const) : ("SELF_REPORTED" as const),
    source: null,
    at: new Date(computedAt).toISOString(),
  };

  return (
    <div className="text-sm mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="num">
        {t("marketCap")}: <strong>{formatCompact(marketCapUsd)}</strong>
      </span>
      {fdvUsd != null && (
        <span className="num text-muted">
          {t("fdv")}: {formatCompact(fdvUsd)}
        </span>
      )}
      <ProvenanceBadge entry={entry} />
    </div>
  );
}
