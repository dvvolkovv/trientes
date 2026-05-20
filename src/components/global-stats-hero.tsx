import { useTranslations } from "next-intl";
import type { GlobalSnap, ExchangeRates } from "@/lib/coingecko";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";

export function GlobalStatsHero({
  stats,
  currency,
  rates,
}: {
  stats: GlobalSnap | null;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = useTranslations("listing");
  if (!stats) return null;
  const r = rates ?? {};
  const fmt = (n: number) =>
    rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e9).toFixed(2)}B`;
  const items = [
    { label: t("globalMarketCap"), value: fmt(stats.totalMarketCapUsd) },
    { label: t("globalVolume"), value: fmt(stats.total24hVolumeUsd) },
    { label: t("btcDominance"), value: `${stats.btcDominancePct.toFixed(1)}%` },
    { label: t("ethDominance"), value: `${stats.ethDominancePct.toFixed(1)}%` },
  ];
  return (
    <div className="space-y-5">
      {items.map((s) => (
        <div
          key={s.label}
          className="flex items-baseline justify-between border-b border-hairline pb-3"
        >
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
            {s.label}
          </div>
          <div className="num text-[22px] font-medium">{s.value}</div>
        </div>
      ))}
    </div>
  );
}
