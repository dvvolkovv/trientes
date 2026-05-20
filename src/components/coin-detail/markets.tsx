import { getTranslations } from "next-intl/server";
import { fetchTickers, type TickerRow } from "@/lib/coingecko";
import { formatPriceInCurrency, formatCompactInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";

export async function MarketsTable({
  coinId,
  currency,
  rates,
}: {
  coinId: string;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = await getTranslations("detail");
  let tickers: TickerRow[] = [];
  try {
    tickers = await fetchTickers(coinId);
  } catch {
    return null;
  }
  const top = [...tickers].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 10);
  if (top.length === 0) return null;
  const r = rates ?? {};
  const fmtP = (n: number) =>
    rates ? formatPriceInCurrency(n, currency, r) : `$${n.toFixed(2)}`;
  const fmtV = (n: number) =>
    rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e6).toFixed(2)}M`;
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{t("topMarkets")}</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">{t("exchange")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("pair")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("price")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("volume")}</th>
            </tr>
          </thead>
          <tbody>
            {top.map((tk, i) => (
              <tr key={`${tk.exchange}-${tk.base}-${tk.target}-${i}`} className="border-b">
                <td className="px-3 py-3">
                  {tk.tradeUrl ? (
                    <a href={tk.tradeUrl} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                      {tk.exchange}
                    </a>
                  ) : (
                    tk.exchange
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {tk.base}/{tk.target}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtP(tk.priceUsd)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtV(tk.volumeUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
