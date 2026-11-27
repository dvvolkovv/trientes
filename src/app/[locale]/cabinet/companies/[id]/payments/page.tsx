import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canManageMembers } from "@/lib/business";
import { CabinetBackButton } from "@/components/cabinet/back-button";
import { PayLinkSection } from "@/components/business/pay-link-section";
import { csrfToken } from "@/lib/csrf";
import { currentFreshLoginAt } from "@/lib/session-fresh";
import { contactFreezeUntil, loginFresh } from "@/lib/pay-link/rules";
import { payCabinetHref, payHref } from "@/lib/pay-link/parse";
import { readPayLinkState } from "@/lib/pay-link/store";
import { hasAnyChannel, readChannels } from "@/lib/pay-link/channels";

export const dynamic = "force-dynamic";

/**
 * Приём платежей Trientes (слайс CP).
 *
 * Это и есть «страница правки карточки» задания: именно её `next.config` закрывает
 * заголовками `frame-ancestors 'none'` и `X-Frame-Options: DENY` — кнопку «да» нельзя
 * нажать через чужой фрейм. Свой адрес, а не состояние страницы предприятия, ровно
 * поэтому: заголовок ставится на маршрут.
 *
 * Видит только владелец (§ 1). Право «карточка» тут не годится: им наделяют
 * сотрудника, а сменить получателя денег вправе лишь владелец (решение BE).
 */
export default async function CompanyPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("payLink");
  const { userId, company, role } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canManageMembers(role)) notFound();

  const [state, csrf, freshAt, me, channels] = await Promise.all([
    readPayLinkState(company.id),
    csrfToken(),
    currentFreshLoginAt(),
    prisma.user.findUnique({ where: { id: userId }, select: { contactChangedAt: true } }),
    // Живой прогон вскрыл это: `notifyEmail` у записи по умолчанию **выключен** (так в
    // схеме с фазы 10), и владелец с подтверждённой почтой оказывался без каналов — а
    // без них смена существующей ссылки запрещена. Состояние надо показать заранее, а
    // не отказом после попытки (правило BG о погасшей кнопке).
    readChannels(userId),
  ]);
  const now = new Date();
  const frozen = contactFreezeUntil(me?.contactChangedAt ?? null, now);

  return (
    <main className="mx-auto w-full max-w-[760px] overflow-x-clip px-4 py-8 md:px-6">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="mb-5 text-[12px] text-muted">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-4">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="mt-1 text-[13px] leading-snug text-muted">{t("subtitle")}</p>
      </header>

      {company.suspendedAt ? (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">
          {t("error.suspended")}
        </p>
      ) : null}

      <PayLinkSection
        companyId={company.id}
        locale={locale}
        csrf={csrf ?? ""}
        cabinetHref={payCabinetHref(locale)}
        current={
          state.link
            ? {
                linkId: state.link.linkId,
                merchantId: state.link.merchantId,
                merchantName: state.link.merchantName,
                title: state.link.title,
                amount: state.link.amount,
                unit: state.link.unit,
                coinSymbol: state.link.coinSymbol,
                checkedAt: state.link.checkedAt.toISOString(),
                disabled: state.link.disabledAt !== null,
                hidden: state.link.hiddenAt !== null,
                hiddenReason: state.link.hiddenReason,
                payHref: payHref(locale, state.link.linkId),
              }
            : null
        }
        pending={
          state.pending
            ? {
                linkId: state.pending.linkId,
                merchantId: state.pending.merchantId,
                merchantName: state.pending.merchantName,
                effectiveAt: state.pending.effectiveAt.toISOString(),
              }
            : null
        }
        loginFresh={loginFresh(freshAt, now)}
        reauthHref={`/${locale}/cabinet/reauth?next=${encodeURIComponent(
          `/${locale}/cabinet/companies/${company.id}/payments`,
        )}`}
        frozenUntil={frozen ? frozen.toISOString() : null}
        reachable={hasAnyChannel(channels)}
      />

      {/* Журнал смен (§ 2.5): кто, когда и с чего на что. Строка не удаляется никогда —
          поддержке надо знать, куда шли платежи. */}
      <PayLinkJournal companyId={company.id} locale={locale} />
    </main>
  );
}

async function PayLinkJournal({ companyId, locale }: { companyId: string; locale: string }) {
  const t = await getTranslations("payLink");
  const rows = await prisma.companyPayLinkChange.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, action: true, afterLinkId: true, afterMerchantId: true,
      beforeMerchantId: true, note: true, createdAt: true, ip: true,
      actor: { select: { username: true, name: true, email: true } },
    },
  });
  if (rows.length === 0) return null;
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const ACTIONS = ["SET", "SCHEDULED", "APPLIED", "CANCELLED", "REMOVED", "DISABLED", "HIDDEN"];
  return (
    <section className="mt-6 space-y-2">
      <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("journalTitle")}</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-hairline bg-card px-3 py-2 text-[12.5px]">
            <div className="flex flex-wrap items-baseline gap-2">
              {/* Незнакомый код показываем как есть: журнал неизменяем, и строка
                  старого вида обязана остаться читаемой (правило BE). */}
              <span className="font-semibold">
                {ACTIONS.includes(r.action) ? t(`journal.${r.action}`) : r.action}
              </span>
              <span className="num text-muted">{fmt.format(r.createdAt)}</span>
            </div>
            <div className="mt-0.5 text-muted">
              {r.actor?.username ?? r.actor?.name ?? r.actor?.email ?? t("journalBySystem")}
              {r.beforeMerchantId ? ` · ${r.beforeMerchantId}` : ""}
              {r.afterMerchantId ? ` → ${r.afterMerchantId}` : ""}
              {r.afterLinkId ? ` · ${r.afterLinkId}` : ""}
              {r.ip ? ` · ${r.ip}` : ""}
              {r.note ? ` · ${r.note}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
