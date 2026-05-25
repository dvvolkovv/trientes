import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureUsername } from "@/lib/ensure-username";
import { ProfileSection } from "@/components/cabinet/profile-section";
import { SettingsSection } from "@/components/cabinet/settings-section";
import { AlertsStub } from "@/components/cabinet/alerts-stub";
import { CompaniesSection } from "@/components/cabinet/companies-section";
import { ExchangesSection } from "@/components/cabinet/exchanges-section";

export default async function CabinetPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login?next=/${locale}/cabinet`);

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect(`/${locale}/login`);
  if (!user.username) {
    await ensureUsername(userId);
    user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) redirect(`/${locale}/login`);
  }

  const t = await getTranslations("cabinet");

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 md:py-16 flex flex-col gap-10">
      <header>
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
          {t("kicker")}
        </div>
        <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("title")}
        </h1>
        <p className="text-muted">{t("subtitle")}</p>
      </header>

      <ProfileSection
        initial={{
          username: user.username ?? "",
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          phone: user.phone ?? "",
          email: user.email ?? "",
          hasPassword: !!user.passwordHash,
        }}
      />

      <SettingsSection
        initialLocale={user.preferredLocale}
        initialCurrency={user.preferredCurrency}
        initialTheme={user.preferredTheme}
      />

      <AlertsStub locale={locale} />

      <CompaniesSection locale={locale} />

      <ExchangesSection locale={locale} />
    </main>
  );
}
