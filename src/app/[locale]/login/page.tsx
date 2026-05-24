import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { LoginButtons } from "@/components/login-buttons";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">
        ● Sign in
      </div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
        {t("signIn")}
      </h1>
      <p className="text-muted mb-8">
        Continue with your preferred provider or sign in with a password.
      </p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <LoginButtons
          locale={locale}
          telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME}
          next={typeof next === "string" ? next : undefined}
        />
      </div>
    </main>
  );
}
