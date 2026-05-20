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
      <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
        Section
      </div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("topMarkets")}
      </h2>
      <div className="bg-card border border-hairline rounded-[20px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.18em] text-muted border-b border-hairline">
                <th className="text-left font-medium px-5 py-4">{t("exchange")}</th>
                <th className="text-left font-medium px-5 py-4">{t("pair")}</th>
                <th className="text-right font-medium px-5 py-4">{t("price")}</th>
                <th className="text-right font-medium px-5 py-4">{t("volume")}</th>
              </tr>
            </thead>
            <tbody>
              {top.map((tk, i) => (
                <tr
                  key={`${tk.exchange}-${tk.base}-${tk.target}-${i}`}
                  className={
                    i < top.length - 1 ? "border-b border-hairline" : ""
                  }
                >
                  <td className="px-5 py-4">
                    {tk.tradeUrl ? (
                      <a
                        href={tk.tradeUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-foreground hover:underline"
                      >
                        {tk.exchange}
                      </a>
                    ) : (
                      <span className="text-foreground">{tk.exchange}</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-muted">
                    {tk.base}/{tk.target}
                  </td>
                  <td className="num text-right px-5 py-4">{fmtP(tk.priceUsd)}</td>
                  <td className="num text-right px-5 py-4 text-muted">
                    {fmtV(tk.volumeUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
