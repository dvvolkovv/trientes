import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { SubscriptionsSection } from "@/components/cabinet/subscriptions-section";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireCabinetUser(locale, "/cabinet/subscriptions");
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("promos.subscriptions.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <SubscriptionsSection locale={locale} />
    </CabinetSectionShell>
  );
}
