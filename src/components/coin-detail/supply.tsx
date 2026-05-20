import { getTranslations } from "next-intl/server";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates, MarketRow } from "@/lib/coingecko";

export async function SupplyMetrics({
  row,
  currency,
  rates,
}: {
  row: MarketRow;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = await getTranslations("detail");
  const r = rates ?? {};
  const fmtSupply = (n: number | null) => {
    if (n === null) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    return n.toLocaleString("en-US");
  };
  const cards = [
    {
      label: t("marketCap"),
      value: rates ? formatCompactInCurrency(row.marketCapUsd, currency, r) : `$${(row.marketCapUsd / 1e9).toFixed(2)}B`,
    },
    {
      label: t("volume24h"),
      value: rates ? formatCompactInCurrency(row.volume24hUsd, currency, r) : `$${(row.volume24hUsd / 1e9).toFixed(2)}B`,
    },
    { label: t("circulating"), value: `${fmtSupply(row.circulatingSupply)} ${row.symbol}` },
    { label: t("total"), value: row.totalSupply ? `${fmtSupply(row.totalSupply)} ${row.symbol}` : "—" },
    { label: t("max"), value: row.maxSupply ? `${fmtSupply(row.maxSupply)} ${row.symbol}` : "—" },
  ];
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{t("stats")}</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-base font-medium mt-1 tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
