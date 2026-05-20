import { useTranslations } from "next-intl";
import type { GlobalSnap } from "@/lib/coingecko";
import { formatCompact } from "@/lib/format";

export function GlobalStatsHero({ stats }: { stats: GlobalSnap | null }) {
  const t = useTranslations("listing");
  if (!stats) return null;
  const cards = [
    { label: t("globalMarketCap"), value: formatCompact(stats.totalMarketCapUsd) },
    { label: t("globalVolume"), value: formatCompact(stats.total24hVolumeUsd) },
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
