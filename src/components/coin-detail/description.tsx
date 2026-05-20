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
      <h2 className="text-lg font-semibold mb-3">{t("about")}</h2>
      <ExpandableDescription htmlShort={cleanShort} htmlFull={cleanFull} />
    </section>
  );
}
