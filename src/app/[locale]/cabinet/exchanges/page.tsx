import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { ExchangesSection } from "@/components/cabinet/exchanges-section";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireCabinetUser(locale, "/cabinet/exchanges");
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.exchanges.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <ExchangesSection locale={locale} />
    </CabinetSectionShell>
  );
}
