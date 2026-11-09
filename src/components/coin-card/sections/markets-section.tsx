import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { formatCompact, formatPercent, formatPrice } from "@/lib/format";
import { ProvenanceBadge } from "../provenance-badge";
import { ExternalLink } from "../external-link";

type Market = {
  id: string;
  kind: string;
  exchangeName: string;
  pair: string;
  tradeUrl: string | null;
  chain: string | null;
  priceUsd: number | null;
  volumeUsd24h: number | null;
  change24h: number | null;
  isOutlier: boolean;
  checkError: string | null;
  confirmedAt: Date | string | null;
};

/** Ошибки, которые говорят о самом заявлении, а не о нашей связи с биржей. */
const CLAIM_ERRORS = new Set(["pair_not_found", "base_mismatch"]);

export async function MarketsSection({
  markets,
  provenance,
}: {
  markets: Market[];
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard");
  if (markets.length === 0) return null;

  const hasPrices = markets.some((m) => m.priceUsd != null);

  return (
    <section id="card-markets" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.markets")}
        <ProvenanceBadge entry={getProvenance(provenance, "markets")} />
      </h2>
      <div className="overflow-x-auto border border-hairline rounded-md">
        <table className="w-full text-sm">
          <thead className="text-muted text-[12px] uppercase tracking-[0.15em]">
            <tr className="border-b border-hairline">
              <th className="text-left px-4 py-3">{t("market.exchange")}</th>
              <th className="text-left px-4 py-3">{t("market.pair")}</th>
              <th className="text-left px-4 py-3">{t("market.kind")}</th>
              {hasPrices && <th className="text-right px-4 py-3">{t("market.price")}</th>}
              {hasPrices && <th className="text-right px-4 py-3">{t("market.change24h")}</th>}
              {hasPrices && <th className="text-right px-4 py-3">{t("market.volume24h")}</th>}
              <th className="text-right px-4 py-3">{t("market.status")}</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3">
                  <ExternalLink href={m.tradeUrl} className="text-accent">
                    {m.exchangeName}
                  </ExternalLink>
                  {!m.tradeUrl && m.exchangeName}
                </td>
                <td className="px-4 py-3 num">{m.pair}</td>
                <td className="px-4 py-3 text-muted">
                  {m.kind}
                  {m.chain ? ` · ${m.chain}` : ""}
                </td>
                {hasPrices && (
                  <td className="px-4 py-3 text-right num">
                    {m.priceUsd != null ? formatPrice(m.priceUsd) : "—"}
                  </td>
                )}
                {hasPrices && (
                  <td
                    className={`px-4 py-3 text-right num ${
                      m.change24h == null ? "" : m.change24h >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {m.change24h != null ? formatPercent(m.change24h) : "—"}
                  </td>
                )}
                {hasPrices && (
                  <td className="px-4 py-3 text-right num">
                    {m.volumeUsd24h != null ? formatCompact(m.volumeUsd24h) : "—"}
                  </td>
                )}
                <td className="px-4 py-3 text-right text-xs">
                  {m.checkError ? (
                    <span className={CLAIM_ERRORS.has(m.checkError) ? "text-down" : "text-muted"}>
                      {t(`market.error.${m.checkError}`)}
                    </span>
                  ) : m.isOutlier ? (
                    <span className="text-muted" title={t("market.outlierHint")}>
                      {t("market.outlier")}
                    </span>
                  ) : m.confirmedAt ? (
                    <span className="text-up">{t("market.confirmed")}</span>
                  ) : (
                    <span className="text-muted">{t("market.claimed")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
