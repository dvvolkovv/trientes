import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { ProfileSection } from "@/components/cabinet/profile-section";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale, "/cabinet/profile");
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.profile.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <ProfileSection
        initial={{
          username: user.username ?? "",
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          phone: user.phone ?? "",
          email: user.email ?? "",
          hasPassword: !!user.passwordHash,
          emailVerified: !!user.emailVerified,
        }}
      />
    </CabinetSectionShell>
  );
}
