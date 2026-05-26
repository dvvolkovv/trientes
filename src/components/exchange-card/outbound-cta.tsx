import { getTranslations } from "next-intl/server";

export async function ExchangeOutboundCta({ name, url }: { name: string; url: string | null }) {
  if (!url) return null;
  const t = await getTranslations("exchangeCard");
  return (
    <section className="bg-card border border-hairline rounded-[16px] p-5">
      <p className="text-[13px] text-muted mb-3">{t("outbound.disclaimer")}</p>
      <a
        href={url}
        target="_blank"
        rel="nofollow sponsored noopener noreferrer"
        className="inline-flex items-center justify-center w-full bg-foreground text-bg font-semibold rounded-md px-4 py-3 text-[14px] hover:opacity-90"
      >
        {t("outbound.cta", { name })}
      </a>
    </section>
  );
}
