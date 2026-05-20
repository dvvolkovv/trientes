import Image from "next/image";
import Link from "next/link";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { formatPercent } from "@/lib/format";
import { formatPriceInCurrency, type Currency } from "@/lib/currency";
import { Sparkline } from "./sparkline";
import { WatchlistButton } from "./watchlist-button";

function pctClass(v: number | null): string {
  if (v === null) return "text-muted";
  return v >= 0 ? "text-up" : "text-down";
}

export function CoinCardMobile({
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
    <div className="block bg-card border border-hairline rounded-[16px] p-4 hover:bg-bg-tint transition-colors">
      <div className="flex justify-between items-center mb-3">
        <Link
          href={`/${locale}/coin/${row.id}`}
          className="flex items-center gap-3 hover:underline flex-1 min-w-0"
        >
          {row.logoUrl ? (
            <Image
              src={row.logoUrl}
              alt=""
              width={28}
              height={28}
              className="rounded-full flex-shrink-0"
              unoptimized
            />
          ) : (
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${fallbackBg}`}
              aria-hidden
            >
              {row.symbol[0]?.toUpperCase()}
            </div>
          )}
          <span className="font-medium truncate">{row.name}</span>
          <span className="num text-[11px] uppercase tracking-wider text-muted flex-shrink-0">
            {row.symbol}
          </span>
        </Link>
        <div className="flex-shrink-0 ml-2">
          <WatchlistButton
            coinId={row.id}
            initialWatched={isWatched}
            isAuthed={isAuthed}
            locale={locale}
            size="sm"
          />
        </div>
      </div>
      <div className="flex justify-between items-end gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="num text-[11px] text-muted">#{row.rank}</span>
          <span className={`num text-[12px] ${pctClass(row.pctChange24h)}`}>
            {formatPercent(row.pctChange24h)}
          </span>
        </div>
        <div
          className="num text-[18px] font-medium flex-1 text-center truncate"
          data-live-price={row.id}
        >
          {rates
            ? formatPriceInCurrency(row.priceUsd, currency, ratesOrEmpty)
            : `$${row.priceUsd.toFixed(2)}`}
        </div>
        <div className="flex-shrink-0">
          <Sparkline points={row.sparkline7d} width={64} height={20} />
        </div>
      </div>
    </div>
  );
}
