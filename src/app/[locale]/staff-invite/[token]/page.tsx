import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { peekStaffInvite } from "@/app/actions/staff-invites";
import { AcceptStaffInvite } from "@/components/admin/accept-staff-invite";
import { QUEUES } from "@/lib/cases/queues";

export const dynamic = "force-dynamic";

/**
 * Приём приглашения. Охранников доступа тут нет и быть не может: приходит
 * человек, у которого прав ещё нет — право даёт сама ссылка.
 */
export default async function StaffInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("staffInvite");
  const tq = await getTranslations("admin.queues.names");
  const tl = await getTranslations("admin.staff.access.levels");

  const invite = await peekStaffInvite(token);
  const session = await auth();
  const signedIn = Boolean((session?.user as { id?: string } | undefined)?.id);
  const next = `/${locale}/staff-invite/${token}`;
  const queueName = (key: string) =>
    QUEUES.some((q) => q.key === key) ? tq(key as never) : key;

  return (
    <main className="mx-auto max-w-md px-6 py-10 md:py-24">
      <div className="num mb-4 text-[11px] uppercase tracking-[0.3em] text-accent">
        ● {t("title")}
      </div>

      {!invite.ok ? (
        <>
          <h1 className="mb-2 text-[32px] font-bold tracking-[-0.03em] md:text-[44px]">
            {t(`errors.${invite.reason}` as never)}
          </h1>
          <Link href={`/${locale}`} className="text-sm font-medium text-accent">
            {t("goToQueues")}
          </Link>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-[32px] font-bold tracking-[-0.03em] md:text-[44px]">
            {invite.title ?? t("title")}
          </h1>
          {invite.invitedBy ? (
            <p className="mb-6 text-muted">{t("invitedBy", { who: invite.invitedBy })}</p>
          ) : null}

          <div className="rounded-[20px] border border-hairline bg-card p-6 md:p-8">
            {invite.duties ? (
              <div className="mb-4">
                <div className="mb-1 text-[9.5px] uppercase tracking-[0.15em] text-muted">
                  {t("duties")}
                </div>
                <p className="whitespace-pre-line text-[13px] leading-snug">{invite.duties}</p>
              </div>
            ) : null}

            <div className="mb-5">
              <div className="mb-1 text-[9.5px] uppercase tracking-[0.15em] text-muted">
                {t("grants")}
              </div>
              <ul className="flex flex-col gap-0.5 text-[13px]">
                {invite.grants.map((g) => (
                  <li key={g.queue}>
                    {queueName(g.queue)} —{" "}
                    <span className="font-semibold">{tl(g.level as never)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {signedIn ? (
              <AcceptStaffInvite
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
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
                  >
                    {t("signIn")}
                  </Link>
                  <Link
                    href={`/${locale}/register?next=${encodeURIComponent(next)}`}
                    className="rounded-md border border-hairline px-4 py-2 text-sm font-medium"
                  >
                    {t("register")}
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
