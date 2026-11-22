import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { SettingsSection } from "@/components/cabinet/settings-section";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale, "/cabinet/settings");
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.settings.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <SettingsSection
        initialLocale={user.preferredLocale}
        initialCurrency={user.preferredCurrency}
        initialTheme={user.preferredTheme}
      />
    </CabinetSectionShell>
  );
}
