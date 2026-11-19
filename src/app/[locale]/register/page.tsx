import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { RegisterForm } from "@/components/register-form";
import { TalerIdButton } from "@/components/taler-id-button";
import { talerIdProvider } from "@/lib/taler-id";
import { safeNext } from "@/lib/safe-next";

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  const target = safeNext(next, locale);
  const session = await auth();
  if (session?.user) redirect(target);
  const t = await getTranslations("register");
  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">
        ● {t("kicker")}
      </div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
        {t("title")}
      </h1>
      <p className="text-muted mb-8">{t("subtitle")}</p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        {talerIdProvider() !== null ? (
          <div className="flex flex-col gap-5 mb-5">
            <TalerIdButton />
            <div className="relative flex items-center my-1">
              <div className="flex-grow border-t border-hairline" />
              <span className="px-3 text-[11px] uppercase tracking-[0.2em] text-muted">{t("orSeparator")}</span>
              <div className="flex-grow border-t border-hairline" />
            </div>
          </div>
        ) : null}
        <RegisterForm locale={locale} next={target} />
      </div>
    </main>
  );
}
