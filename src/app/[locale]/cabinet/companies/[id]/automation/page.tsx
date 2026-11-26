import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { CabinetBackButton } from "@/components/cabinet/back-button";
import { RulesPanel } from "@/components/automation/rules-panel";
import { WebhooksPanel } from "@/components/automation/webhooks-panel";
import { readConditionOptions, readEvents, readRuleTargets, readRules, readWebhooks } from "@/lib/automation/read";
import { automationKeyConfigured } from "@/lib/automation/secret";
import { RULE_FIRES_PER_DAY } from "@/lib/automation/rules";

export const dynamic = "force-dynamic";

/**
 * Автоматизация предприятия (слайс CO, ТЗ 6.7): правила «если — то», лента событий и
 * исходящие оповещения наружу.
 *
 * Лента событий стоит **между** правилами и оповещениями нарочно: это дверь «почему не
 * сработало», и она нужна обоим разделам. Без неё конструктор правил неотлаживаем —
 * человек видит только то, что ничего не произошло.
 */
export default async function CompanyAutomationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetAutomation");
  const { userId, company, role, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "automation")) notFound();
  const canEdit = canEditSection(permissions, "automation");
  const isOwner = role === "OWNER";

  const [rules, events, members, options, hooks] = await Promise.all([
    readRules(company.id),
    readEvents(company.id),
    readRuleTargets(company.id),
    readConditionOptions(company.id),
    isOwner ? readWebhooks(company.id) : Promise.resolve([]),
  ]);

  const when = (at: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(at);

  return (
    <main className="mx-auto w-full max-w-[900px] overflow-x-clip px-4 py-8 md:px-6">
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

      <header className="mb-2">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="mt-1 text-[13px] leading-snug text-muted">{t("subtitle")}</p>
      </header>

      <RulesPanel
        companyId={company.id}
        canEdit={canEdit}
        locale={locale}
        members={members.map((m) => ({ id: m.userId, label: m.label }))}
        options={options}
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          trigger: r.trigger,
          action: r.action,
          conditions: r.conditions as Record<string, unknown>,
          task: r.taskParams
            ? {
                title: r.taskParams.title,
                details: r.taskParams.details ?? null,
                priority: r.taskParams.priority,
                dueDays: r.taskParams.dueDays ?? null,
                assigneeId: r.taskParams.assigneeId ?? null,
              }
            : null,
          notify: r.notifyParams ? { text: r.notifyParams.text, userIds: r.notifyParams.userIds } : null,
          enabled: r.enabled,
          firedCount: r.firedCount,
          lastFiredAt: r.lastFiredAt ? r.lastFiredAt.toISOString() : null,
          runs: r.runs.map((run) => ({
            id: run.id,
            outcome: run.outcome,
            reason: run.reason,
            createdAt: run.createdAt.toISOString(),
          })),
        }))}
      />

      <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("rules.dailyLimit", { count: RULE_FIRES_PER_DAY })}</p>

      <section className="mt-9">
        <h2 className="mb-2 text-[12px] uppercase tracking-[0.2em] text-muted">{t("events.heading")}</h2>
        <p className="mb-3 text-[12.5px] leading-snug text-muted">{t("events.hint")}</p>
        {events.length === 0 ? (
          <p className="text-[13px] text-muted">{t("events.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex min-h-10 flex-wrap items-center gap-2 rounded-[10px] border border-hairline bg-card px-3 py-1.5"
              >
                <span className="text-[12.5px]">{t(`trigger.${event.kind}` as never)}</span>
                {event.subject ? (
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{event.subject}</span>
                ) : (
                  <span className="flex-1" />
                )}
                {event.source === "RULE" ? (
                  <span className="shrink-0 rounded-[8px] border border-hairline px-2 text-[11px] text-muted">
                    {t("events.fromRule")}
                  </span>
                ) : null}
                <span className="shrink-0 text-[11.5px] text-muted num">{when(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner ? (
        automationKeyConfigured() ? (
          <WebhooksPanel
            companyId={company.id}
            locale={locale}
            hooks={hooks.map((h) => ({
              id: h.id,
              url: h.url,
              events: h.events,
              enabled: h.enabled,
              createdAt: h.createdAt.toISOString(),
              lastDeliveredAt: h.lastDeliveredAt ? h.lastDeliveredAt.toISOString() : null,
              lastFailedAt: h.lastFailedAt ? h.lastFailedAt.toISOString() : null,
              lastError: h.lastError,
              deliveries: h.deliveries.map((d) => ({
                id: d.id,
                kind: d.kind,
                status: d.status,
                attempts: d.attempts,
                lastStatus: d.lastStatus,
                lastError: d.lastError,
                createdAt: d.createdAt.toISOString(),
              })),
            }))}
          />
        ) : (
          /* Нет ключа приложения — раздела нет, и сказано почему: дверь, ведущая в
             тишину, хуже отсутствия двери (правило AV и CI). */
          <section className="mt-9">
            <h2 className="mb-2 text-[12px] uppercase tracking-[0.2em] text-muted">{t("hooks.heading")}</h2>
            <p className="rounded-[12px] border border-hairline bg-card p-3 text-[12.5px] leading-snug text-muted">
              {t("hooks.notConfigured")}
            </p>
          </section>
        )
      ) : null}
    </main>
  );
}
