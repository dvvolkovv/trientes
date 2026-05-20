import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { Exchange, ExchangeRates } from "@/lib/coingecko";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";

function trustBadgeCls(score: number | null): string {
  if (score === null) return "bg-card-alt text-muted";
  if (score >= 9) return "bg-up/15 text-up";
  if (score >= 7) return "bg-accent/15 text-accent";
  return "bg-down/15 text-down";
}

export async function ExchangesTable({
  rows,
  currency,
  rates,
}: {
  rows: Exchange[];
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = await getTranslations("exchanges");
  const r = rates ?? {};
  const fmtV = (n: number) =>
    rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e9).toFixed(2)}B`;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-hairline rounded-[20px] overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.18em] text-muted border-b border-hairline">
              <th className="text-left font-medium px-5 py-4">{t("rank")}</th>
              <th className="text-left font-medium px-5 py-4">{t("name")}</th>
              <th className="text-left font-medium px-5 py-4">{t("trust")}</th>
              <th className="text-left font-medium px-5 py-4">{t("country")}</th>
              <th className="text-left font-medium px-5 py-4">{t("founded")}</th>
              <th className="text-right font-medium px-5 py-4">{t("volume24h")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.id}
                className="border-b border-hairline hover:bg-bg-tint transition-colors"
              >
                <td className="num px-5 py-5 text-[13px] text-muted">
                  {e.trustScoreRank ?? "—"}
                </td>
                <td className="px-5 py-5">
                  <div className="flex items-center gap-3">
                    {e.logoUrl && (
                      <Image
                        src={e.logoUrl}
                        alt=""
                        width={28}
                        height={28}
                        className="rounded"
                        unoptimized
                      />
                    )}
                    {e.url ? (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="font-medium text-[15px] hover:underline"
                      >
                        {e.name}
                      </a>
                    ) : (
                      <span className="font-medium text-[15px]">{e.name}</span>
                    )}
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
                <td className="num px-5 py-5 text-[13px] text-muted">
                  {e.yearEstablished ?? "—"}
                </td>
                <td className="num text-right text-[13px] px-5 py-5 font-medium">
                  {fmtV(e.volume24hUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {rows.map((e) => (
          <div
            key={e.id}
            className="bg-card border border-hairline rounded-[16px] p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              {e.logoUrl && (
                <Image
                  src={e.logoUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="rounded flex-shrink-0"
                  unoptimized
                />
              )}
              <div className="flex-1 min-w-0">
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="font-medium hover:underline block truncate"
                  >
                    {e.name}
                  </a>
                ) : (
                  <span className="font-medium block truncate">{e.name}</span>
                )}
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
              <span className="num text-[14px] font-medium">
                {fmtV(e.volume24hUsd)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
