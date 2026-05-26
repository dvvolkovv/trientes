import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";

function fmtUsd(n: number | null): string {
  if (n === null || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(n: number | null): string {
  if (n === null || n <= 0) return "—";
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toPrecision(4)}`;
}

const STALE_THRESHOLD_HOURS = 48;
const NEW_THRESHOLD_DAYS = 7;
const TOP_N = 50;

export async function ExchangeCardPairs({ exchangeId }: { exchangeId: string }) {
  const t = await getTranslations("exchangeCard");
  const staleBefore = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
  const newAfter = new Date(Date.now() - NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const markets = await prisma.exchangeMarket.findMany({
    where: {
      exchangeId,
      lastSeenAt: { gte: staleBefore },
      outlier: false,
    },
    orderBy: { volumeUsd24h: "desc" },
    take: TOP_N,
  });

  if (markets.length === 0) {
    return (
      <section>
        <h2 className="text-[15px] font-semibold mb-3">{t("pairs.title")}</h2>
        <div className="bg-card border border-hairline rounded-[16px] p-5 text-[13px] text-muted">
          {t("pairs.empty")}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[15px] font-semibold">{t("pairs.title")}</h2>
        <span className="text-[11px] text-muted">{t("pairs.topN", { count: markets.length })}</span>
      </div>
      <div className="bg-card border border-hairline rounded-[16px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-muted text-[11px] uppercase tracking-[0.14em] border-b border-hairline">
                <th className="text-left px-4 py-3 font-medium">{t("pairs.columns.pair")}</th>
                <th className="text-right px-4 py-3 font-medium">{t("pairs.columns.price")}</th>
                <th className="text-right px-4 py-3 font-medium">{t("pairs.columns.volume24h")}</th>
                <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">{t("pairs.columns.share")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {markets.map((m) => {
                const isNew = m.firstSeenAt >= newAfter;
                const pairLabel = (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.pair}</span>
                    {isNew && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-[1px] rounded bg-accent/15 text-accent font-semibold">
                        {t("pairs.newBadge")}
                      </span>
                    )}
                    {m.category && m.category !== "spot" && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-[1px] rounded bg-muted/15 text-muted">
                        {m.category}
                      </span>
                    )}
                  </div>
                );
                return (
                  <tr key={m.id} className="hover:bg-hairline/40 transition-colors">
                    <td className="px-4 py-3">
                      {m.marketUrl ? (
                        <a
                          href={m.marketUrl}
                          target="_blank"
                          rel="nofollow noopener noreferrer"
                          className="hover:text-accent transition-colors"
                        >
                          {pairLabel}
                        </a>
                      ) : (
                        pairLabel
                      )}
                    </td>
                    <td className="px-4 py-3 text-right num">{fmtPrice(m.priceUsd)}</td>
                    <td className="px-4 py-3 text-right num">{fmtUsd(m.volumeUsd24h)}</td>
                    <td className="px-4 py-3 text-right num text-muted hidden sm:table-cell">
                      {m.volumeSharePct !== null ? `${m.volumeSharePct.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
