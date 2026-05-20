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
  const fmt = (n: number) => (rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e9).toFixed(2)}B`);
  const cards = [
    { label: t("globalMarketCap"), value: fmt(stats.totalMarketCapUsd) },
    { label: t("globalVolume"), value: fmt(stats.total24hVolumeUsd) },
    { label: t("btcDominance"), value: `${stats.btcDominancePct.toFixed(1)}%` },
    { label: t("ethDominance"), value: `${stats.ethDominancePct.toFixed(1)}%` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      {cards.map((c) => (
        <div key={c.label} className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="text-2xl font-semibold mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
