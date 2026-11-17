import { setRequestLocale, getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("reset");
  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">
        ● {t("kicker")}
      </div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
        {t("requestTitle")}
      </h1>
      <p className="text-muted mb-8">{t("requestSubtitle")}</p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <ForgotPasswordForm locale={locale} />
      </div>
    </main>
  );
}
