import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatPriceInCurrency, formatCompactInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";
import type { TopExchange } from "@/lib/listings";
import { exchangeDirectoryByName } from "@/lib/exchange-directory";
import { OWN_DEX_NAME } from "@/lib/coin-card-dex-market";

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
  const locale = await getLocale();
  // Логотип и карточка биржи — из каталога, одним запросом на всю таблицу.
  const directory = await exchangeDirectoryByName(top.map((e) => e.exchange));
  const r = rates ?? {};
  const fmtP = (n: number) =>
    rates ? formatPriceInCurrency(n, currency, r) : `$${n.toFixed(2)}`;
  // Объём неизвестен — так и говорим: ноль здесь означал бы «торгов не было».
  const fmtV = (n: number | null) =>
    n == null ? "—" : rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e6).toFixed(2)}M`;
  /**
   * Биржа строки: знак и ссылка. Наш собственный обмен выделен цветом — он
   * единственный здесь свой, и у него свой логотип; остальные ведут на
   * карточку биржи, когда она у нас есть.
   */
  const exchangeCell = (tk: TopExchange) => {
    const own = tk.exchange === OWN_DEX_NAME;
    const entry = own ? null : directory.get(tk.exchange.toLowerCase());
    const tone = own ? "text-accent" : "text-foreground";
    const label = <span className={`${tone} truncate`}>{tk.exchange}</span>;
    return (
      <span className="inline-flex items-center gap-2 min-w-0">
        {/* Место под знак занято всегда: без заглушки строки без логотипа
            уезжают влево относительно соседних. */}
        {own ? (
          <Image
            src="/logo.png"
            alt=""
            width={20}
            height={20}
            className="rounded-full border border-hairline shrink-0"
          />
        ) : entry?.logoUrl ? (
          <Image
            src={entry.logoUrl}
            alt=""
            width={20}
            height={20}
            className="rounded-full border border-hairline shrink-0"
            unoptimized
          />
        ) : (
          <span className="w-5 h-5 shrink-0 rounded-full bg-bg-tint border border-hairline" />
        )}
        {entry ? (
          <Link href={`/${locale}/exchanges/${entry.id}`} className="hover:underline min-w-0">
            {label}
          </Link>
        ) : tk.tradeUrl ? (
          <a
            href={tk.tradeUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="hover:underline min-w-0"
          >
            {label}
          </a>
        ) : (
          label
        )}
      </span>
    );
  };

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
                  <td className="px-5 py-4">{exchangeCell(tk)}</td>
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
              <span className="font-medium min-w-0 truncate">{exchangeCell(tk)}</span>
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
