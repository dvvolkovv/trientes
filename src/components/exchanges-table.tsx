"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Exchange, ExchangeRates } from "@/lib/coingecko";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";
import { ExchangeStar } from "@/components/exchange-star";

const VISIBLE = 25; // rows shown before "show all"

function trustBadgeCls(score: number | null): string {
  if (score === null) return "bg-card-alt text-muted";
  if (score >= 9) return "bg-up/15 text-up";
  if (score >= 7) return "bg-accent/15 text-accent";
  return "bg-down/15 text-down";
}

export function ExchangesTable({
  rows,
  currency,
  rates,
  watchedIds,
  isAuthed,
  locale,
  collapsible = true,
}: {
  rows: Exchange[];
  currency: Currency;
  rates: ExchangeRates | null;
  watchedIds: string[];
  isAuthed: boolean;
  locale: string;
  collapsible?: boolean;
}) {
  const t = useTranslations("exchanges");
  const [expanded, setExpanded] = useState(false);
  const watched = new Set(watchedIds);
  const r = rates ?? {};
  const fmtV = (n: number) =>
    n <= 0 ? "—" : rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e9).toFixed(2)}B`;

  const shown = collapsible && !expanded ? rows.slice(0, VISIBLE) : rows;
  const canCollapse = collapsible && rows.length > VISIBLE;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-hairline rounded-[20px] overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.18em] text-muted border-b border-hairline">
              <th className="w-10 px-3 py-4" />
              <th className="text-left font-medium px-5 py-4">{t("rank")}</th>
              <th className="text-left font-medium px-5 py-4">{t("name")}</th>
              <th className="text-left font-medium px-5 py-4">{t("trust")}</th>
              <th className="text-left font-medium px-5 py-4">{t("country")}</th>
              <th className="text-left font-medium px-5 py-4">{t("founded")}</th>
              <th className="text-right font-medium px-5 py-4">{t("volume24h")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className="border-b border-hairline hover:bg-bg-tint transition-colors">
                <td className="px-3 py-5 text-center align-middle">
                  <ExchangeStar
                    exchangeId={e.id}
                    initialWatched={watched.has(e.id)}
                    isAuthed={isAuthed}
                    locale={locale}
                  />
                </td>
                <td className="num px-5 py-5 text-[13px] text-muted">{e.trustScoreRank ?? "—"}</td>
                <td className="px-5 py-5">
                  <div className="flex items-center gap-3">
                    {e.logoUrl && (
                      <Image src={e.logoUrl} alt="" width={28} height={28} className="rounded" unoptimized />
                    )}
                    <Link
                      href={`/${locale}/exchanges/${e.id}`}
                      className="font-medium text-[15px] hover:underline"
                    >
                      {e.name}
                    </Link>
                  </div>
                </td>
                <td className="px-5 py-5">
                  <span
                    className={`num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium ${trustBadgeCls(e.trustScore)}`}
                  >
                    {e.trustScore ?? "—"}/10
                  </span>
                </td>
                <td className="px-5 py-5 text-[13px] text-muted">{e.country ?? "—"}</td>
                <td className="num px-5 py-5 text-[13px] text-muted">{e.yearEstablished ?? "—"}</td>
                <td className="num text-right text-[13px] px-5 py-5 font-medium">{fmtV(e.volume24hUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {shown.map((e) => (
          <div key={e.id} className="bg-card border border-hairline rounded-[16px] p-4">
            <div className="flex items-center gap-3 mb-3">
              <ExchangeStar
                exchangeId={e.id}
                initialWatched={watched.has(e.id)}
                isAuthed={isAuthed}
                locale={locale}
              />
              {e.logoUrl && (
                <Image src={e.logoUrl} alt="" width={28} height={28} className="rounded flex-shrink-0" unoptimized />
              )}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/${locale}/exchanges/${e.id}`}
                  className="font-medium hover:underline block truncate"
                >
                  {e.name}
                </Link>
                <div className="num text-[11px] text-muted">
                  {e.country ?? "—"} · {e.yearEstablished ?? "—"}
                </div>
              </div>
              <span
                className={`num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium flex-shrink-0 ${trustBadgeCls(e.trustScore)}`}
              >
                {e.trustScore ?? "—"}/10
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="num text-[11px] text-muted uppercase tracking-wider">
                #{e.trustScoreRank ?? "—"}
              </span>
              <span className="num text-[14px] font-medium">{fmtV(e.volume24hUsd)}</span>
            </div>
          </div>
        ))}
      </div>

      {canCollapse && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12px] px-4 py-2 rounded-md font-medium border border-hairline text-muted hover:text-foreground transition-all uppercase tracking-wider"
          >
            {expanded ? t("collapse") : t("showAll", { count: rows.length })}
          </button>
        </div>
      )}
    </>
  );
}
