import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadMfaGate, loadViewerAccess } from "@/lib/authz/guard";
import { MfaVerifyForm } from "@/components/mfa/verify-form";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

export default async function MfaPage({
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
  if (!access) redirect(`/${locale}/login?next=/${locale}/admin`);
  const gate = await loadMfaGate();
  // Фактора ещё нет — заводить, а не вводить; уже показан — экран не нужен.
  if (gate === "setup") redirect(`/${locale}/mfa/setup`);
  if (gate === "ok") redirect(`/${locale}/admin`);

  const t = await getTranslations("mfa");
  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">● {t("kicker")}</div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("verifyTitle")}</h1>
      <p className="text-muted mb-8">{t("verifySubtitle")}</p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <MfaVerifyForm
          locale={locale}
          next={typeof next === "string" ? safeNext(next, locale) : `/${locale}/admin`}
        />
      </div>
    </main>
  );
}
