import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { CasesSection } from "@/components/cabinet/cases-section";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale, "/cabinet/cases");
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.cases.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <CasesSection locale={locale} userId={user.id} />
    </CabinetSectionShell>
  );
}
