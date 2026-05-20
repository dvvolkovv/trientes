import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { Exchange, ExchangeRates } from "@/lib/coingecko";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";

function trustBadgeCls(score: number | null): string {
  if (score === null) return "bg-muted text-muted-foreground";
  if (score >= 9) return "bg-green-500/15 text-green-700 dark:text-green-400";
  if (score >= 7) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
  return "bg-red-500/15 text-red-700 dark:text-red-400";
}

export async function ExchangesTable({
  rows,
  currency,
  rates,
}: {
  rows: Exchange[];
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = await getTranslations("exchanges");
  const r = rates ?? {};
  const fmtV = (n: number) =>
    rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e9).toFixed(2)}B`;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">{t("rank")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("name")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("trust")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("country")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("founded")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("volume24h")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b hover:bg-muted/30">
              <td className="px-3 py-3 tabular-nums text-muted-foreground">{e.trustScoreRank ?? "—"}</td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  {e.logoUrl && (
                    <Image src={e.logoUrl} alt="" width={20} height={20} className="rounded" unoptimized />
                  )}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">
                      {e.name}
                    </a>
                  ) : (
                    <span className="font-medium">{e.name}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3">
                <span className={`px-2 py-0.5 text-xs rounded ${trustBadgeCls(e.trustScore)}`}>
                  {e.trustScore ?? "—"}/10
                </span>
              </td>
              <td className="px-3 py-3 text-muted-foreground">{e.country ?? "—"}</td>
              <td className="px-3 py-3 tabular-nums text-muted-foreground">{e.yearEstablished ?? "—"}</td>
              <td className="px-3 py-3 tabular-nums text-right">{fmtV(e.volume24hUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
