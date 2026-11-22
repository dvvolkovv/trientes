import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { notFound } from "next/navigation";
import { isStaffRole, type ViewerRole } from "@/lib/authz/policy";
import { MfaSection } from "@/components/cabinet/mfa-section";

export const dynamic = "force-dynamic";

export default async function CabinetSectionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale, "/cabinet/mfa");
  // Плитка второго фактора видна только сотруднику — страница обязана быть
  // закрыта тем же правилом, иначе скрытая ссылка это не защита (правило AS).
  if (!isStaffRole(user.role as ViewerRole)) notFound();
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.mfa.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <MfaSection locale={locale} userId={user.id} />
    </CabinetSectionShell>
  );
}
