import { getTranslations } from "next-intl/server";
import { formatPriceInCurrency, formatCompactInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";
import type { TopExchange } from "@/lib/listings";

export async function MarketsTable({
  exchanges,
  currency,
  rates,
}: {
  exchanges: TopExchange[];
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = await getTranslations("detail");
  const top = exchanges;
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
        {t("topExchanges")}
      </h2>
      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-hairline rounded-[20px] overflow-hidden">
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

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {top.map((tk, i) => (
          <div
            key={`${tk.exchange}-${tk.base}-${tk.target}-${i}`}
            className="bg-card border border-hairline rounded-[16px] p-4"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              {tk.tradeUrl ? (
                <a
                  href={tk.tradeUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-medium text-foreground hover:underline truncate"
                >
                  {tk.exchange}
                </a>
              ) : (
                <span className="font-medium text-foreground truncate">
                  {tk.exchange}
                </span>
              )}
              <span className="num text-[12px] text-muted flex-shrink-0">
                {tk.base}/{tk.target}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted uppercase tracking-wider text-[11px]">
                {t("price")}
              </span>
              <span className="num text-right">{fmtP(tk.priceUsd)}</span>
            </div>
            <div className="flex items-center justify-between text-[13px] mt-1">
              <span className="text-muted uppercase tracking-wider text-[11px]">
                {t("volume")}
              </span>
              <span className="num text-right text-muted">
                {fmtV(tk.volumeUsd)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
