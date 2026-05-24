import { getTranslations } from "next-intl/server";

export async function AlertsStub({ locale }: { locale: string }) {
  const t = await getTranslations("cabinet.alerts");
  return (
    <section id="alerts" className="scroll-mt-24">
      <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-4">
        {t("title")}
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <a
          href={`/${locale}/watchlist`}
          className="bg-card border border-hairline rounded-[20px] p-6 hover:border-accent transition-colors"
        >
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-2">{t("watchlistKicker")}</div>
          <div className="text-lg font-semibold mb-1">{t("watchlistTitle")}</div>
          <p className="text-sm text-muted">{t("watchlistBody")}</p>
        </a>
        <div className="bg-card-alt border border-hairline rounded-[20px] p-6 opacity-70">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-2">{t("alertsKicker")}</div>
          <div className="text-lg font-semibold mb-1">{t("alertsTitle")}</div>
          <p className="text-sm text-muted">{t("alertsBody")}</p>
        </div>
      </div>
    </section>
  );
}
