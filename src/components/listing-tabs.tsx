"use client";

import { useState, type ReactNode } from "react";

/**
 * Switches the main listing between the market-ranked table and self-listed
 * cards. They are two different kinds of data — one has a price and a rank,
 * the other does not — so they share a place without sharing a table.
 */
export function ListingTabs({
  marketLabel,
  selfLabel,
  selfCount,
  market,
  self,
}: {
  marketLabel: string;
  selfLabel: string;
  selfCount: number;
  market: ReactNode;
  self: ReactNode;
}) {
  const [tab, setTab] = useState<"market" | "self">("market");
  // Nothing self-listed yet: don't show a tab that leads to an empty panel.
  if (selfCount === 0) return <>{market}</>;

  const cls = (active: boolean) =>
    `px-4 py-2 text-[12px] uppercase tracking-[0.18em] border-b-2 -mb-px transition-colors whitespace-nowrap ${
      active
        ? "border-accent text-foreground"
        : "border-transparent text-muted hover:text-foreground"
    }`;

  return (
    <div>
      <div className="flex border-b border-hairline mb-6 overflow-x-auto">
        <button type="button" className={cls(tab === "market")} onClick={() => setTab("market")}>
          {marketLabel}
        </button>
        <button type="button" className={cls(tab === "self")} onClick={() => setTab("self")}>
          {selfLabel}
          <span className="num ml-2 text-muted">{selfCount}</span>
        </button>
      </div>
      {tab === "market" ? market : self}
    </div>
  );
}
