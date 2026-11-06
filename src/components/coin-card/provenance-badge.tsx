import { getTranslations } from "next-intl/server";
import { PROVENANCE_EPOCH, type ProvenanceEntry } from "@/lib/coin-card-provenance";

const TONE: Record<ProvenanceEntry["kind"], string> = {
  SELF_REPORTED: "text-muted border-hairline",
  AGGREGATED: "text-foreground border-hairline",
  VERIFIED_ONCHAIN: "text-up border-up/40",
  ADMIN_SET: "text-accent border-accent/40",
};

/**
 * The differentiator: every value states where it came from. Rendered inline,
 * next to the number it qualifies.
 */
export async function ProvenanceBadge({ entry }: { entry: ProvenanceEntry }) {
  const t = await getTranslations("coinCard.provenance");
  const at = entry.at && entry.at !== PROVENANCE_EPOCH
    ? new Date(entry.at).toISOString().slice(0, 10)
    : null;
  const title = [t(entry.kind), entry.source, at].filter(Boolean).join(" · ");
  return (
    <span
      title={title}
      className={`inline-block ml-2 align-middle text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${TONE[entry.kind]}`}
    >
      {t(`${entry.kind}_short`)}
    </span>
  );
}
