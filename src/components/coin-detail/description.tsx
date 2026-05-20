import { getTranslations } from "next-intl/server";
import { sanitizeDescription } from "@/lib/sanitize";
import { ExpandableDescription } from "./expandable-description";

const PREVIEW_CHARS = 500;

export async function Description({ html }: { html: string | null }) {
  if (!html) return null;
  const t = await getTranslations("detail");
  const cleanFull = sanitizeDescription(html);
  // Plain-text length test (rough — fine for choosing between short/full).
  const plain = cleanFull.replace(/<[^>]+>/g, "");
  const cleanShort =
    plain.length > PREVIEW_CHARS
      ? sanitizeDescription(html.slice(0, PREVIEW_CHARS) + "…")
      : cleanFull;
  return (
    <section>
      <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
        Section
      </div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("about")}
      </h2>
      <ExpandableDescription htmlShort={cleanShort} htmlFull={cleanFull} />
    </section>
  );
}
