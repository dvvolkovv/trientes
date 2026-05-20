import { useTranslations } from "next-intl";
import type { MarketRow } from "@/lib/coingecko";
import { CoinRow } from "./coin-row";

export function CoinTable({ rows }: { rows: MarketRow[] }) {
  const t = useTranslations("listing");
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">{t("rank")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("name")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("price")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("change1h")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("change24h")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("change7d")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("marketCap")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("volume24h")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CoinRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
