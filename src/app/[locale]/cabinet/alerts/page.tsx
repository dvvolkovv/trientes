import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { AlertsSection } from "@/components/cabinet/alerts-section";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale, "/cabinet/alerts");
  const telegramAccount = await prisma.account.findFirst({
    where: { userId: user.id, provider: "telegram" },
    select: { id: true },
  });
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.alerts.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <AlertsSection
        userId={user.id}
        notifyTelegram={user.notifyTelegram}
        notifyEmail={user.notifyEmail}
        hasEmail={!!user.email}
        emailVerified={!!user.emailVerified}
        hasTelegramLinked={!!telegramAccount}
        locale={locale}
      />
    </CabinetSectionShell>
  );
}
