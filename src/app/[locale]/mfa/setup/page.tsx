import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadMfaGate, loadViewerAccess } from "@/lib/authz/guard";
import { isStaffRole } from "@/lib/authz/policy";
import { MfaSetupForm } from "@/components/mfa/setup-form";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

export default async function MfaSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);

  const access = await loadViewerAccess();
  if (!access) redirect(`/${locale}/login?next=/${locale}/cabinet`);
  const home = isStaffRole(access.role) ? `/${locale}/admin` : `/${locale}/cabinet/profile`;
  const back = typeof next === "string" ? safeNext(next, locale) : home;
  const gate = await loadMfaGate();
  // Фактор уже заведён: «перевести на другой телефон» идёт тем же экраном, но
  // только после того, как человек показал код в этом сеансе.
  if (gate === "verify") redirect(`/${locale}/mfa?next=${encodeURIComponent(back)}`);

  const t = await getTranslations("mfa");
  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">● {t("kicker")}</div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("setupTitle")}</h1>
      <p className="text-muted mb-8">{t("setupSubtitle")}</p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <MfaSetupForm locale={locale} next={back} />
      </div>
    </main>
  );
}
