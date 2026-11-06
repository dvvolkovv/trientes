import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
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
  confirmedAt: Date | string | null;
};

export async function MarketsSection({
  markets,
  provenance,
}: {
  markets: Market[];
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard");
  if (markets.length === 0) return null;

  // Until the aggregator lands (slice C) no market has a price. Hide the
  // column entirely rather than drawing a row of dashes.
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
                    {m.priceUsd != null ? `$${m.priceUsd}` : "—"}
                  </td>
                )}
                <td className="px-4 py-3 text-right text-xs">
                  <span className={m.confirmedAt ? "text-up" : "text-muted"}>
                    {m.confirmedAt ? t("market.confirmed") : t("market.claimed")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
