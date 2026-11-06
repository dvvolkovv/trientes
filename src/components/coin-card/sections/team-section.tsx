import { getTranslations } from "next-intl/server";
import { ExternalLink } from "../external-link";

type Member = { name?: string; role?: string; link?: string };
type TeamInfo = { members?: Member[] | null; investors?: string[] | null; partners?: string[] | null };

export async function TeamSection({ teamInfo }: { teamInfo: unknown }) {
  const t = await getTranslations("coinCard");
  const d = (teamInfo ?? {}) as TeamInfo;
  const members = (d.members ?? []).filter((m) => m.name);
  const investors = (d.investors ?? []).filter(Boolean);
  if (members.length === 0 && investors.length === 0) return null;

  return (
    <section id="card-team" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.team")}
      </h2>
      {members.length > 0 && (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {members.map((m, i) => (
            <li key={`${m.name}-${i}`} className="border border-hairline rounded-md p-4 bg-card">
              <p className="font-semibold">{m.name}</p>
              {m.role && <p className="text-muted text-sm">{m.role}</p>}
              <ExternalLink href={m.link} className="text-accent text-xs mt-1 inline-block">
                {t("profile")}
              </ExternalLink>
            </li>
          ))}
        </ul>
      )}
      {investors.length > 0 && (
        <div>
          <h3 className="text-[12px] uppercase tracking-[0.15em] text-muted mb-2">
            {t("investors")}
          </h3>
          <p className="text-sm">{investors.join(" · ")}</p>
        </div>
      )}
    </section>
  );
}
