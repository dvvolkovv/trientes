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
      <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
        Section
      </div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("stats")}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-card border border-hairline rounded-md px-4 py-3"
          >
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1.5">
              {c.label}
            </div>
            <div className="num text-[16px] font-medium">{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
