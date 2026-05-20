import Image from "next/image";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { formatPriceInCurrency, type Currency } from "@/lib/currency";
import { formatPercent } from "@/lib/format";
import { WatchlistButton } from "@/components/watchlist-button";

export function CoinHeader({
  row,
  currency,
  rates,
  isWatched,
  isAuthed,
  locale,
}: {
  row: MarketRow;
  currency: Currency;
  rates: ExchangeRates | null;
  isWatched: boolean;
  isAuthed: boolean;
  locale: string;
}) {
  const pct = row.pctChange24h;
  const pctCls =
    pct === null ? "text-muted" : pct >= 0 ? "text-up" : "text-down";
  const initial = (row.symbol || row.name || "?").charAt(0).toUpperCase();
  return (
    <header className="bg-card border border-hairline rounded-[20px] p-6 md:p-12">
      <div className="flex flex-col md:flex-row md:items-start gap-6">
        <div className="flex items-start gap-6 flex-1 min-w-0">
          {row.logoUrl ? (
            <Image
              src={row.logoUrl}
              alt=""
              width={64}
              height={64}
              className="w-16 h-16 rounded-full flex-shrink-0"
              unoptimized
            />
          ) : (
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-accent text-accent-foreground text-[24px] font-bold flex-shrink-0">
              {initial}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-[28px] sm:text-[40px] md:text-[56px] font-bold tracking-[-0.035em] leading-[1]">
                {row.name}
              </h1>
              <WatchlistButton
                coinId={row.id}
                initialWatched={isWatched}
                isAuthed={isAuthed}
                locale={locale}
                size="md"
              />
              <span className="num text-[16px] uppercase tracking-[0.15em] text-muted">
                {row.symbol}
              </span>
              <span className="num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm bg-card-alt text-muted-strong border border-hairline">
                <span className="text-accent">★</span> Rank {row.rank}
              </span>
            </div>
            <div className="mt-2 num text-[11px] uppercase tracking-[0.2em] text-muted">
              Layer-1 · Native asset
            </div>
          </div>
        </div>
        <div className="text-left md:text-right md:flex-shrink-0">
          <div
            className="num text-[32px] sm:text-[44px] md:text-[60px] font-medium tracking-[-0.03em] leading-[1]"
            data-live-price={row.id}
          >
            {rates
              ? formatPriceInCurrency(row.priceUsd, currency, rates)
              : `$${row.priceUsd.toFixed(2)}`}
          </div>
          <div className="mt-2 flex items-center justify-start md:justify-end gap-3 num text-[14px]">
            <span className={pctCls}>{formatPercent(pct)}</span>
            <span className="text-muted">24h</span>
          </div>
        </div>
      </div>
    </header>
  );
}
