import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { ProvenanceBadge } from "../provenance-badge";

type Tokenomics = {
  circulating?: number | null;
  total?: number | null;
  max?: number | null;
  excludedAddresses?: string[] | null;
  emission?: string | null;
  burnMechanism?: string | null;
};

const fmt = (n: number | null | undefined) =>
  n == null ? null : new Intl.NumberFormat("en-US").format(n);

export async function TokenomicsSection({
  tokenomics,
  provenance,
}: {
  tokenomics: unknown;
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard");
  const d = (tokenomics ?? {}) as Tokenomics;
  const rows: Array<[string, string | null, string]> = [
    [t("supply.circulating"), fmt(d.circulating), "tokenomics.circulating"],
    [t("supply.total"), fmt(d.total), "tokenomics.total"],
    [t("supply.max"), fmt(d.max), "tokenomics.max"],
  ].filter((r) => r[1] !== null) as Array<[string, string, string]>;

  const hasMethod =
    (d.excludedAddresses?.length ?? 0) > 0 || Boolean(d.emission) || Boolean(d.burnMechanism);
  if (rows.length === 0 && !hasMethod) return null;

  return (
    <section id="tokenomics" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.tokenomics")}
      </h2>
      {rows.length > 0 && (
        <dl className="grid sm:grid-cols-3 gap-4 mb-6">
          {rows.map(([label, value, path]) => (
            <div key={path} className="border border-hairline rounded-md p-4 bg-card">
              <dt className="text-[12px] uppercase tracking-[0.15em] text-muted mb-1">{label}</dt>
              <dd className="num text-lg">
                {value}
                <ProvenanceBadge entry={getProvenance(provenance, path)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {hasMethod && (
        <div className="border border-hairline rounded-md p-4 bg-card space-y-3">
          <h3 className="text-[12px] uppercase tracking-[0.15em] text-muted">
            {t("supply.methodology")}
          </h3>
          {d.emission && <p className="text-sm">{t("supply.emission")}: {d.emission}</p>}
          {d.burnMechanism && <p className="text-sm">{t("supply.burn")}: {d.burnMechanism}</p>}
          {(d.excludedAddresses?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm text-muted mb-1">{t("supply.excluded")}</p>
              <ul className="space-y-1">
                {d.excludedAddresses?.map((a) => (
                  <li key={a} className="font-mono text-xs break-all text-muted">{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
