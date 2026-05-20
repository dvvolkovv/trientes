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
  const pctCls = pct === null ? "text-muted-foreground" : pct >= 0 ? "text-green-500" : "text-red-500";
  return (
    <header className="flex items-center gap-4">
      {row.logoUrl && (
        <Image src={row.logoUrl} alt="" width={48} height={48} className="rounded-full" unoptimized />
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold">{row.name}</h1>
          <WatchlistButton
            coinId={row.id}
            initialWatched={isWatched}
            isAuthed={isAuthed}
            locale={locale}
            size="md"
          />
          <span className="text-muted-foreground uppercase">{row.symbol}</span>
          <span className="ml-2 px-2 py-0.5 text-xs border rounded bg-muted">#{row.rank}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="text-3xl font-semibold tabular-nums">
          {rates ? formatPriceInCurrency(row.priceUsd, currency, rates) : `$${row.priceUsd.toFixed(2)}`}
        </div>
        <div className={`text-sm tabular-nums ${pctCls}`}>{formatPercent(pct)} (24h)</div>
      </div>
    </header>
  );
}
