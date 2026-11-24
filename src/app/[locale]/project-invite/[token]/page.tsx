import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { peekProjectInvite } from "@/app/actions/project-invites";
import { AcceptProjectInvite } from "@/components/claims/accept-project-invite";

export const dynamic = "force-dynamic";

/**
 * Приём приглашения из приветственного письма (слайс CI). Охранников прав тут
 * нет: право даёт сама ссылка, отправленная на доказанный адрес доказанного
 * домена.
 */
export default async function ProjectInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projectInvite");

  const invite = await peekProjectInvite(token, locale);
  const session = await auth();
  const signedIn = Boolean((session?.user as { id?: string } | undefined)?.id);
  const next = `/${locale}/project-invite/${token}`;

  return (
    <main className="mx-auto max-w-md px-6 py-10 md:py-24">
      <div className="num mb-4 text-[11px] uppercase tracking-[0.3em] text-accent">
        ● {t("kicker")}
      </div>

      {!invite.ok ? (
        <>
          <h1 className="mb-2 text-[32px] font-bold tracking-[-0.03em] md:text-[44px]">
            {t(`errors.${invite.reason}` as never)}
          </h1>
          <Link href={`/${locale}/for-projects`} className="text-sm font-medium text-accent">
            {t("forProjects")}
          </Link>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-[32px] font-bold tracking-[-0.03em] md:text-[44px]">
            {invite.subjectName}
          </h1>
          <p className="mb-6 text-muted">{t("proved", { domain: invite.domain })}</p>

          <div className="rounded-[20px] border border-hairline bg-card p-6 md:p-8">
            <p className="mb-5 text-[13px] leading-snug">
              {t(`what.${invite.subjectKind}` as never)}
            </p>

            {signedIn ? (
              <AcceptProjectInvite
                token={token}
                locale={locale}
                labels={{
                  accept: t("accept"),
                  accepted: t("accepted"),
                  errors: {
                    invalid: t("errors.invalid"),
                    expired: t("errors.expired"),
                    accepted: t("errors.accepted"),
                    revoked: t("errors.revoked"),
                    already_owned: t("errors.already_owned"),
                    subject_gone: t("errors.subject_gone"),
                    unauth: t("errors.unauth"),
                    failed: t("errors.failed"),
                  },
                }}
              />
            ) : (
              <>
                <p className="mb-4 text-sm text-muted">{t("guest")}</p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/${locale}/login?next=${encodeURIComponent(next)}`}
                    className="rounded-md bg-accent px-4 py-3 text-[13px] font-semibold text-black"
                  >
                    {t("signIn")}
                  </Link>
                  <Link
                    href={`/${locale}/register?next=${encodeURIComponent(next)}`}
                    className="rounded-md border border-hairline px-4 py-3 text-[13px] font-semibold"
                  >
                    {t("signUp")}
                  </Link>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
