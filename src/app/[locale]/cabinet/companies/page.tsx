import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { CompaniesSection } from "@/components/cabinet/companies-section";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { locale } = await params;
  const { card: cardParam } = await searchParams;
  setRequestLocale(locale);
  await requireCabinetUser(locale, "/cabinet/companies");
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.companies.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <CompaniesSection locale={locale} cardParam={cardParam} />
    </CabinetSectionShell>
  );
}
