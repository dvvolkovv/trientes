import { getTranslations } from "next-intl/server";

export async function ExchangeCardDescription({ description }: { description: string | null }) {
  if (!description) return null;
  const t = await getTranslations("exchangeCard");
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("description.title")}</h2>
      <div className="bg-card border border-hairline rounded-[16px] p-5 text-[14px] leading-relaxed whitespace-pre-line">
        {description}
      </div>
    </section>
  );
}
