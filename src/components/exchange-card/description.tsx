import { getTranslations } from "next-intl/server";

export type DescriptionSource = "wikipedia" | "coinpaprika";

export async function ExchangeCardDescription({
  description,
  source,
  sourceUrl,
  sourceLang,
}: {
  description: string | null;
  source: DescriptionSource | null;
  sourceUrl?: string | null;
  sourceLang?: string | null;
}) {
  if (!description) return null;
  const t = await getTranslations("exchangeCard");
  const label =
    source === "wikipedia"
      ? t("description.source.wikipedia")
      : source === "coinpaprika"
        ? t("description.source.coinpaprika")
        : null;
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("description.title")}</h2>
      <div className="bg-card border border-hairline rounded-[16px] p-5">
        <div className="text-[14px] leading-relaxed whitespace-pre-line">{description}</div>
        {label && (
          <div className="text-[11px] text-muted mt-3 pt-3 border-t border-hairline">
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                {label}
                {sourceLang && source === "wikipedia" ? ` · ${sourceLang}` : ""}
              </a>
            ) : (
              <>
                {label}
                {sourceLang && source === "wikipedia" ? ` · ${sourceLang}` : ""}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
