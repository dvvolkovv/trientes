import Image from "next/image";
import Link from "next/link";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { formatPercent } from "@/lib/format";
import { formatPriceInCurrency, formatCompactInCurrency, type Currency } from "@/lib/currency";
import { Sparkline } from "./sparkline";
import { WatchlistButton } from "./watchlist-button";

function pctClass(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  return v >= 0 ? "text-green-500" : "text-red-500";
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
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="px-3 py-3 text-sm text-muted-foreground tabular-nums">{row.rank}</td>
      <td className="px-3 py-3">
        <Link
          href={`/${locale}/coin/${row.id}`}
          className="flex items-center gap-2 hover:underline"
        >
          {row.logoUrl && (
            <Image src={row.logoUrl} alt="" width={20} height={20} className="rounded-full" unoptimized />
          )}
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground uppercase">{row.symbol}</span>
        </Link>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {rates ? formatPriceInCurrency(row.priceUsd, currency, ratesOrEmpty) : `$${row.priceUsd.toFixed(2)}`}
      </td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange1h)}`}>{formatPercent(row.pctChange1h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange24h)}`}>{formatPercent(row.pctChange24h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange7d)}`}>{formatPercent(row.pctChange7d)}</td>
      <td className="px-3 py-3 text-right tabular-nums">
        {rates ? formatCompactInCurrency(row.marketCapUsd, currency, ratesOrEmpty) : `$${(row.marketCapUsd / 1e9).toFixed(2)}B`}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {rates ? formatCompactInCurrency(row.volume24hUsd, currency, ratesOrEmpty) : `$${(row.volume24hUsd / 1e9).toFixed(2)}B`}
      </td>
      <td className="px-3 py-3">
        <Sparkline points={row.sparkline7d} />
      </td>
      <td className="px-3 py-3 text-right">
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
