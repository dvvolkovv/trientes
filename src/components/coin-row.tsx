import Image from "next/image";
import Link from "next/link";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { formatPercent } from "@/lib/format";
import { formatPriceInCurrency, formatCompactInCurrency, type Currency } from "@/lib/currency";
import { Sparkline } from "./sparkline";
import { WatchlistButton } from "./watchlist-button";

function pctClass(v: number | null): string {
  if (v === null) return "text-muted";
  return v >= 0 ? "text-up" : "text-down";
}

export function CoinRow({
  row,
  currency,
  rates,
  locale,
  isWatched,
  isAuthed,
}: {
  row: MarketRow;
  currency: Currency;
  rates: ExchangeRates | null;
  locale: string;
  isWatched: boolean;
  isAuthed: boolean;
}) {
  const ratesOrEmpty = rates ?? {};
  const isBtc = row.symbol.toUpperCase() === "BTC";
  const fallbackBg = isBtc
    ? "bg-accent text-accent-foreground"
    : "bg-card-alt text-foreground";

  return (
    <tr className="border-b border-hairline hover:bg-bg-tint transition-colors">
      <td className="num px-5 py-5 text-[13px] text-muted">{row.rank}</td>
      <td className="px-5 py-5">
        <Link
          href={`/${locale}/coin/${row.id}`}
          className="flex items-center gap-3 hover:underline"
        >
          {row.logoUrl ? (
            <Image
              src={row.logoUrl}
              alt=""
              width={28}
              height={28}
              className="rounded-full"
              unoptimized
            />
          ) : (
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${fallbackBg}`}
              aria-hidden
            >
              {row.symbol[0]?.toUpperCase()}
            </div>
          )}
          <span className="font-medium text-[15px]">{row.name}</span>
          <span className="num text-[11px] uppercase tracking-wider text-muted">
            {row.symbol}
          </span>
        </Link>
      </td>
      <td
        className="num text-right text-[15px] font-medium px-5 py-5"
        data-live-price={row.id}
      >
        {rates
          ? formatPriceInCurrency(row.priceUsd, currency, ratesOrEmpty)
          : `$${row.priceUsd.toFixed(2)}`}
      </td>
      <td className={`num text-right text-[13px] px-5 py-5 ${pctClass(row.pctChange1h)}`}>
        {formatPercent(row.pctChange1h)}
      </td>
      <td className={`num text-right text-[13px] px-5 py-5 ${pctClass(row.pctChange24h)}`}>
        {formatPercent(row.pctChange24h)}
      </td>
      <td className={`num text-right text-[13px] px-5 py-5 ${pctClass(row.pctChange7d)}`}>
        {formatPercent(row.pctChange7d)}
      </td>
      <td className="num text-right text-[13px] px-5 py-5 text-muted">
        {rates
          ? formatCompactInCurrency(row.marketCapUsd, currency, ratesOrEmpty)
          : `$${(row.marketCapUsd / 1e9).toFixed(2)}B`}
      </td>
      <td className="num text-right text-[13px] px-5 py-5 text-muted">
        {rates
          ? formatCompactInCurrency(row.volume24hUsd, currency, ratesOrEmpty)
          : `$${(row.volume24hUsd / 1e9).toFixed(2)}B`}
      </td>
      <td className="px-5 py-5">
        <Sparkline points={row.sparkline7d} />
      </td>
      <td className="px-5 py-5 text-center">
        <WatchlistButton
          coinId={row.id}
          initialWatched={isWatched}
          isAuthed={isAuthed}
          locale={locale}
        />
      </td>
    </tr>
  );
}
