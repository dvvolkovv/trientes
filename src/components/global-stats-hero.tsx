import { useTranslations } from "next-intl";
import type { GlobalSnap, ExchangeRates } from "@/lib/coingecko";
import type { FearGreed } from "@/lib/fear-greed";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";

// Map the alternative.me classification to a translation key + a palette colour.
// Colour follows sentiment: fear = down-red, greed = up-green, neutral = accent.
const FNG_KEYS: Record<string, string> = {
  "extreme fear": "fng.extremeFear",
  fear: "fng.fear",
  neutral: "fng.neutral",
  greed: "fng.greed",
  "extreme greed": "fng.extremeGreed",
};

function fngColor(classification: string): string {
  const c = classification.toLowerCase();
  if (c.includes("greed")) return "text-up";
  if (c.includes("fear")) return "text-down";
  return "text-accent";
}

export function GlobalStatsHero({
  stats,
  currency,
  rates,
  fearGreed,
}: {
  stats: GlobalSnap | null;
  currency: Currency;
  rates: ExchangeRates | null;
  fearGreed: FearGreed | null;
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
  const fngKey = fearGreed ? FNG_KEYS[fearGreed.classification.toLowerCase()] : undefined;
  const fngLabel = fearGreed ? (fngKey ? t(fngKey) : fearGreed.classification) : "";
  const fngColorClass = fearGreed ? fngColor(fearGreed.classification) : "";
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
      {fearGreed && (
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
            {t("fearGreed")}
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`num text-[22px] font-medium ${fngColorClass}`}>
              {fearGreed.value}
            </span>
            <span className={`text-[11px] uppercase tracking-[0.12em] ${fngColorClass}`}>
              {fngLabel}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
