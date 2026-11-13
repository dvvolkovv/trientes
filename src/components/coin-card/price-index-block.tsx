import { getTranslations } from "next-intl/server";
import { formatCompact, formatPercent, formatPrice } from "@/lib/format";
import { getProvenance } from "@/lib/coin-card-provenance";
import { ProvenanceBadge } from "./provenance-badge";
import { IndexMethodology } from "./index-methodology";
import { CirculatingLine } from "./circulating-line";
import type { CirculatingView } from "@/lib/coin-card-circulating";

export type PriceIndexView = {
  priceUsd: number;
  change24h: number | null;
  volumeUsd24h: number;
  marketCount: number;
  confidence: string;
  computedAt: Date | string;
};

/**
 * Собственный ценовой индекс в шапке карточки. Показывается там, где он
 * единственный источник цены — у самостоятельно залистингованных монет,
 * которых CoinGecko не знает.
 */
export async function PriceIndexBlock({
  index,
  provenance,
  circulating,
  symbol,
  supplyAt,
}: {
  index: PriceIndexView;
  provenance: unknown;
  circulating: CirculatingView | null;
  symbol: string;
  supplyAt: Date | string | null;
}) {
  const t = await getTranslations("coinCard.index");
  const up = (index.change24h ?? 0) >= 0;
  const at = new Date(index.computedAt).toISOString().slice(0, 16).replace("T", " ");

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="num text-[32px] md:text-[40px] font-bold tracking-[-0.03em]">
          {formatPrice(index.priceUsd)}
        </span>
        {index.change24h != null && (
          <span className={`num text-[16px] font-semibold ${up ? "text-up" : "text-down"}`}>
            {formatPercent(index.change24h)}
          </span>
        )}
        <ProvenanceBadge entry={getProvenance(provenance, "price")} />
      </div>
      <div className="text-xs text-muted mt-1 num">
        {/* Объём показываем, только когда он есть: наш обмен его не публикует
            вовсе, и «$0.00» читалось бы как «торгов не было». */}
        {index.volumeUsd24h > 0 && (
          <>{t("volume", { value: formatCompact(index.volumeUsd24h) })} · </>
        )}
        {t(`confidence.${index.confidence}`)} · {at} UTC
      </div>
      <CirculatingLine view={circulating} symbol={symbol} at={supplyAt} />
      <div className="mt-1">
        <IndexMethodology marketCount={index.marketCount} />
      </div>
    </div>
  );
}
