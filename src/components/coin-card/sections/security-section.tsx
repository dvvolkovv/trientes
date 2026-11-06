import { getTranslations } from "next-intl/server";
import { ExternalLink } from "../external-link";

type Audit = { firm?: string; date?: string; reportUrl?: string; scope?: string };
type Security = {
  audits?: Audit[] | null;
  riskFlags?: Record<string, boolean> | null;
  teamDoxxed?: boolean | null;
  legalEntity?: string | null;
  jurisdiction?: string | null;
};

export async function SecuritySection({ security }: { security: unknown }) {
  const t = await getTranslations("coinCard");
  const d = (security ?? {}) as Security;
  const audits = (d.audits ?? []).filter((a) => a.firm);
  const flags = Object.entries(d.riskFlags ?? {}).filter(([, v]) => v === true);
  if (audits.length === 0 && flags.length === 0 && !d.legalEntity && !d.teamDoxxed) return null;

  return (
    <section id="security" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.security")}
      </h2>
      <div className="space-y-4">
        {audits.map((a, i) => (
          <div key={`${a.firm}-${i}`} className="border border-hairline rounded-md p-4 bg-card">
            <p className="font-semibold">{a.firm}</p>
            {a.date && <p className="text-muted text-xs">{a.date}</p>}
            {a.scope && <p className="text-sm mt-1">{a.scope}</p>}
            <ExternalLink href={a.reportUrl} className="text-accent text-xs mt-1 inline-block">
              {t("audit.report")}
            </ExternalLink>
          </div>
        ))}
        {flags.length > 0 && (
          <div className="border border-down/40 rounded-md p-4">
            <h3 className="text-[12px] uppercase tracking-[0.15em] text-down mb-2">
              {t("risk.title")}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {flags.map(([k]) => (
                <li key={k} className="text-xs text-down border border-down/40 rounded px-2 py-0.5">
                  {k}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(d.legalEntity || d.jurisdiction || d.teamDoxxed) && (
          <div className="border border-hairline rounded-md p-4 bg-card text-sm space-y-1">
            {d.legalEntity && <p>{t("legalEntity")}: {d.legalEntity}</p>}
            {d.jurisdiction && <p>{t("jurisdiction")}: {d.jurisdiction}</p>}
            {d.teamDoxxed && <p className="text-up">{t("teamDoxxed")}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
