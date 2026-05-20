import Image from "next/image";
import type { MarketRow } from "@/lib/coingecko";
import { formatPrice, formatCompact, formatPercent } from "@/lib/format";

function pctClass(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  return v >= 0 ? "text-green-500" : "text-red-500";
}

export function CoinRow({ row }: { row: MarketRow }) {
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="px-3 py-3 text-sm text-muted-foreground tabular-nums">{row.rank}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          {row.logoUrl && (
            <Image
              src={row.logoUrl}
              alt=""
              width={20}
              height={20}
              className="rounded-full"
              unoptimized
            />
          )}
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground uppercase">{row.symbol}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{formatPrice(row.priceUsd)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange1h)}`}>{formatPercent(row.pctChange1h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange24h)}`}>{formatPercent(row.pctChange24h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange7d)}`}>{formatPercent(row.pctChange7d)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{formatCompact(row.marketCapUsd)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{formatCompact(row.volume24hUsd)}</td>
    </tr>
  );
}
