import { cookies } from "next/headers";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { authSessionCookieName } from "@/lib/session";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { ProfileHeader } from "@/components/cabinet/profile-header";
import { ProfileSection } from "@/components/cabinet/profile-section";
import { SettingsSection } from "@/components/cabinet/settings-section";
import { SecuritySection } from "@/components/cabinet/security-section";

export const dynamic = "force-dynamic";

/**
 * «Мой профиль» — единственная дверь к себе (слайс BT): кто я, мои данные, мои
 * настройки, моя безопасность. Отдельных разделов «Настройки» и «Второй фактор»
 * на хабе больше нет: три двери к одному предмету это три места, где человек
 * ищет одно и то же.
 */
export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale, "/cabinet/profile");
  const t = await getTranslations();
  const jar = await cookies();

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.name || (user.username ?? "");

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.profile.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <div className="flex flex-col gap-8">
        <ProfileHeader
          name={fullName}
          username={user.username ?? ""}
          email={user.email}
          emailVerified={!!user.emailVerified}
          phone={user.phone}
          image={user.image}
        />

        <section className="flex flex-col gap-4">
          <h2 className="text-[20px] font-bold tracking-[-0.02em] md:text-[24px]">
            {t("cabinet.profile.dataTitle")}
          </h2>
          <ProfileSection
            initial={{
              username: user.username ?? "",
              firstName: user.firstName ?? "",
              lastName: user.lastName ?? "",
              phone: user.phone ?? "",
              email: user.email ?? "",
              emailVerified: !!user.emailVerified,
            }}
          />
        </section>

        <SettingsSection
          initialLocale={user.preferredLocale}
          initialCurrency={user.preferredCurrency}
          initialTheme={user.preferredTheme}
        />

        <SecuritySection
          locale={locale}
          userId={user.id}
          role={user.role}
          hasPassword={!!user.passwordHash}
          currentSessionToken={jar.get(authSessionCookieName())?.value ?? null}
        />
      </div>
    </CabinetSectionShell>
  );
}
