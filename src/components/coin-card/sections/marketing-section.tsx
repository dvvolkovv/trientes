import { getTranslations } from "next-intl/server";
import { ExternalLink } from "../external-link";

type Milestone = { title?: string; date?: string };
type Marketing = {
  pitch?: string | null;
  roadmap?: Milestone[] | null;
  mediaKit?: string | null;
  videoUrl?: string | null;
};

export async function MarketingSection({
  marketing,
  badge = null,
}: {
  marketing: unknown;
  badge?: React.ReactNode;
}) {
  const t = await getTranslations("coinCard");
  const d = (marketing ?? {}) as Marketing;
  const roadmap = (d.roadmap ?? []).filter((r) => r.title);
  if (!d.pitch && roadmap.length === 0 && !d.mediaKit && !d.videoUrl) return null;

  return (
    <section id="card-about" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.marketing")}
        {badge}
      </h2>
      {d.pitch && <p className="text-sm leading-relaxed mb-6 max-w-[70ch]">{d.pitch}</p>}
      {roadmap.length > 0 && (
        <ol className="space-y-3 mb-6">
          {roadmap.map((r, i) => (
            <li key={`${r.title}-${i}`} className="flex gap-4 items-baseline">
              <span className="num text-muted text-xs shrink-0 w-20">{r.date ?? "—"}</span>
              <span className="text-sm">{r.title}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-4 text-xs">
        <ExternalLink href={d.mediaKit} className="text-accent">{t("mediaKit")}</ExternalLink>
        <ExternalLink href={d.videoUrl} className="text-accent">{t("video")}</ExternalLink>
      </div>
    </section>
  );
}
