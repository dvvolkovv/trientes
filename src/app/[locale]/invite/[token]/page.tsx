import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { inviteState } from "@/lib/company-invites";
import { AcceptInviteButton } from "@/components/business/accept-invite-button";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("invite");
  const tr = await getTranslations("business.members");

  const invite = await prisma.companyInvite.findUnique({
    where: { token },
    select: {
      companyId: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      company: { select: { displayName: true } },
    },
  });

  const state = invite ? inviteState(invite) : "invalid";
  const session = await auth();
  const signedIn = Boolean((session?.user as { id?: string } | undefined)?.id);
  const next = `/${locale}/invite/${token}`;

  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">● {t("kicker")}</div>
      <h1 className="text-[32px] md:text-[44px] font-bold tracking-[-0.03em] mb-2">
        {invite ? t("title", { company: invite.company.displayName }) : t("titleInvalid")}
      </h1>

      {state !== "valid" || !invite ? (
        <>
          <p className="text-muted mb-8">{t(`state.${state}`)}</p>
          <Link href={`/${locale}`} className="text-accent text-sm font-medium">
            {t("backHome")}
          </Link>
        </>
      ) : (
        <>
          <p className="text-muted mb-8">
            {t("roleLine", { role: tr(`role.${invite.role}`) })}
          </p>
          <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
            {signedIn ? (
              <AcceptInviteButton token={token} locale={locale} />
            ) : (
              <>
                <p className="text-sm text-muted mb-4">{t("signInFirst")}</p>
                <div className="flex gap-3 flex-wrap">
                  <Link
                    href={`/${locale}/login?next=${encodeURIComponent(next)}`}
                    className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium"
                  >
                    {t("signIn")}
                  </Link>
                  <Link
                    href={`/${locale}/register?next=${encodeURIComponent(next)}`}
                    className="px-4 py-2 rounded-md border border-hairline text-sm font-medium"
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
