import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { isStaffRole, type ViewerRole } from "@/lib/authz/policy";
import { PasswordForm } from "@/components/cabinet/password-form";
import { DisableOwnMfaButton, SignOutOthersButton } from "@/components/cabinet/security-controls";

/**
 * «Безопасность» (слайс BT): пароль, второй фактор и чужие сеансы — в одном
 * месте, внутри профиля.
 *
 * ПИН-кода и платёжного пароля здесь нет намеренно: платежей на сайте нет ни
 * одного (денежную заявку создаёт обмен, слайс AV), а пароль, которым ничего не
 * подписывают, — обещание безопасности, а не безопасность. Разбор — в спеке.
 */
export async function SecuritySection({
  locale,
  userId,
  role,
  hasPassword,
  currentSessionToken,
}: {
  locale: string;
  userId: string;
  role: string;
  hasPassword: boolean;
  currentSessionToken: string | null;
}) {
  const t = await getTranslations("cabinet.security");
  const staff = isStaffRole(role as ViewerRole);

  const [mfa, codesLeft, sessions] = await Promise.all([
    prisma.staffMfa.findUnique({
      where: { userId },
      select: { confirmedAt: true, disabledAt: true },
    }),
    prisma.staffMfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    prisma.session.findMany({
      where: { userId, expires: { gt: new Date() } },
      select: { sessionToken: true },
    }),
  ]);
  const on = Boolean(mfa?.confirmedAt && !mfa.disabledAt);
  const others = sessions.filter((s) => s.sessionToken !== currentSessionToken).length;
  const setupHref = `/${locale}/mfa/setup?next=${encodeURIComponent(`/${locale}/cabinet/profile`)}`;

  return (
    <section id="security" className="scroll-mt-24 flex flex-col gap-4">
      <h2 className="text-[20px] font-bold tracking-[-0.02em] md:text-[24px]">{t("title")}</h2>

      {/* Пароль */}
      <div className="rounded-[20px] border border-hairline bg-card p-6 md:p-8">
        <h3 className="mb-4 font-semibold">{hasPassword ? t("passwordTitle") : t("passwordSetTitle")}</h3>
        {hasPassword ? null : <p className="mb-4 text-[13px] text-muted">{t("passwordNone")}</p>}
        <PasswordForm hasPassword={hasPassword} />
      </div>

      {/* Второй фактор */}
      <div className="rounded-[20px] border border-hairline bg-card p-6 md:p-8">
        <h3 className="mb-2 font-semibold">{t("mfa.title")}</h3>
        <p className="mb-4 text-[13px] text-muted">{staff ? t("mfa.staffNote") : t("mfa.note")}</p>
        <p className="mb-1 text-sm">
          {on && mfa?.confirmedAt
            ? t("mfa.on", { date: mfa.confirmedAt.toISOString().slice(0, 10) })
            : t("mfa.off")}
        </p>
        {on ? (
          <p className="mb-4 text-[12px] text-muted">{t("mfa.codesLeft", { count: codesLeft })}</p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={setupHref}
            className="flex h-12 items-center justify-center rounded-[14px] bg-accent px-6 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90"
          >
            {on ? t("mfa.rotate") : t("mfa.enable")}
          </Link>
          {/* Снять фактор себе может посетитель, но не сотрудник: у сотрудника
              это право владельца (слайс BA). */}
          {on && !staff ? <DisableOwnMfaButton /> : null}
        </div>
        {on && staff ? <p className="mt-3 text-[12px] text-muted">{t("mfa.ownerOnly")}</p> : null}
      </div>

      {/* Сеансы */}
      <div className="rounded-[20px] border border-hairline bg-card p-6 md:p-8">
        <h3 className="mb-2 font-semibold">{t("sessions.title")}</h3>
        <p className="mb-4 text-[13px] text-muted">{t("sessions.note")}</p>
        <p className="mb-4 text-sm">{t("sessions.count", { count: sessions.length })}</p>
        <SignOutOthersButton others={others} />
      </div>
    </section>
  );
}
