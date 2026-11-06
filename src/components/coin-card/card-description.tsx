import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { ProvenanceBadge } from "./provenance-badge";

export async function CardDescription({
  description,
  provenance,
  badge = null,
}: {
  description: string | null;
  provenance: unknown;
  badge?: React.ReactNode;
}) {
  const t = await getTranslations("coinCard");
  if (!description) return null;
  return (
    <section id="card-description" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.about")}
        <ProvenanceBadge entry={getProvenance(provenance, "description")} />
        {badge}
      </h2>
      {/* Plain text, not markdown: rendering project-supplied HTML would be
          stored XSS. whitespace-pre-line keeps the author's paragraphs. */}
      <p className="text-sm leading-relaxed whitespace-pre-line max-w-[70ch]">{description}</p>
    </section>
  );
}
