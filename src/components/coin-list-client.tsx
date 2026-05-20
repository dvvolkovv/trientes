"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { Input } from "@/components/ui/input";
import { CoinRow } from "./coin-row";
import type { Currency } from "@/lib/currency";

type SortKey = "rank" | "price" | "pctChange24h" | "marketCap" | "volume";
type SortDir = "asc" | "desc";

const SORT_FIELDS: Record<SortKey, (r: MarketRow) => number> = {
  rank: (r) => r.rank,
  price: (r) => r.priceUsd,
  pctChange24h: (r) => r.pctChange24h ?? 0,
  marketCap: (r) => r.marketCapUsd,
  volume: (r) => r.volume24hUsd,
};

function SortHeader({
  label,
  field,
  currentKey,
  currentDir,
  onSort,
  align = "right",
}: {
  label: string;
  field: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = currentKey === field;
  const arrow = isActive ? (currentDir === "asc" ? " ▲" : " ▼") : "";
  return (
    <th
      className={`px-3 py-2 text-${align} font-medium cursor-pointer select-none hover:text-foreground`}
      onClick={() => onSort(field)}
    >
      {label}
      <span className="text-xs">{arrow}</span>
    </th>
  );
}

export function CoinListClient({
  rows,
  currency,
  rates,
  locale,
  watchedSet,
  isAuthed,
}: {
  rows: MarketRow[];
  currency: Currency;
  rates: ExchangeRates | null;
  locale: string;
  watchedSet: Set<string>;
  isAuthed: boolean;
}) {
  const t = useTranslations("listing");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q),
        )
      : rows;
    const fn = SORT_FIELDS[sortKey];
    const sorted = [...base].sort((a, b) => fn(a) - fn(b));
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [rows, query, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <Input
        placeholder={t("search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <SortHeader label={t("rank")} field="rank" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="left" />
              <th className="px-3 py-2 text-left font-medium">{t("name")}</th>
              <SortHeader label={t("price")} field="price" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <th className="px-3 py-2 text-right font-medium">{t("change1h")}</th>
              <SortHeader label={t("change24h")} field="pctChange24h" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <th className="px-3 py-2 text-right font-medium">{t("change7d")}</th>
              <SortHeader label={t("marketCap")} field="marketCap" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <SortHeader label={t("volume24h")} field="volume" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <th className="px-3 py-2 text-left font-medium">{t("sparkline7d")}</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <CoinRow
                key={row.id}
                row={row}
                currency={currency}
                rates={rates}
                locale={locale}
                isWatched={watchedSet.has(row.id)}
                isAuthed={isAuthed}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
