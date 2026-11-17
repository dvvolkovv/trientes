import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { hashResetToken, resetTokenState } from "@/lib/password-reset";
import { ResetPasswordForm } from "@/components/reset-password-form";

// Состояние ссылки читается на каждый заход: страница не кэшируется.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("reset");

  // В базе лежит хэш, поэтому и ищем по хэшу.
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: {
      expiresAt: true,
      usedAt: true,
      user: { select: { username: true, name: true, email: true } },
    },
  });
  const state = row ? resetTokenState(row) : "invalid";

  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">
        ● {t("kicker")}
      </div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
        {t("newTitle")}
      </h1>

      {state !== "valid" || !row ? (
        <>
          <p className="text-muted mb-8">{t(`state.${state}`)}</p>
          <div className="flex gap-4 text-sm font-medium">
            <Link href={`/${locale}/forgot-password`} className="text-accent">
              {t("requestAgain")}
            </Link>
            <Link href={`/${locale}/login`} className="text-muted">
              {t("backToLogin")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted mb-8">
            {t("newSubtitle", {
              username: row.user.username ?? row.user.name ?? row.user.email ?? "",
            })}
          </p>
          <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
            <ResetPasswordForm locale={locale} token={token} />
          </div>
        </>
      )}
    </main>
  );
}
