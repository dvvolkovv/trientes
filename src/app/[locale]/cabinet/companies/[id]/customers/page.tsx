import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { ADMIN_COLUMN, ADMIN_TILE, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { can } from "@/lib/company-team/permissions";
import { readCompanyCustomers } from "@/lib/crm/read";
import {
  CRM_SEGMENTS,
  customerLabel,
  DORMANT_DAYS,
  inSegment,
  isCrmSegment,
  reachable,
  segmentCounts,
  segmentsFor,
} from "@/lib/crm/segments";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Покупатели предприятия: сегменты, числа и список (слайс CN, ТЗ 6.7 «Клиенты» и 6.8
 * «Аналитика клиента»). Раздел охраняется тем же правом `customers`, что переписка:
 * право «отвечать покупателю» без права «знать, кто он» — право вслепую.
 *
 * Деньги охраняются деньгами: оборот и суммы видны только при праве `sales` или
 * `reports`. Иначе раздел переписки стал бы дверью к выручке мимо отчётности.
 */
export default async function CompanyCustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetCrm");
  const format = await getFormatter();
  const { userId, company, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!can(permissions, "customers", "VIEW")) notFound();
  const showMoney = can(permissions, "sales", "VIEW") || can(permissions, "reports", "VIEW");

  const raw = Array.isArray(query.segment) ? query.segment[0] : query.segment;
  const segment = isCrmSegment(raw) ? raw : null;

  const now = new Date();
  const { customers, truncated, anonymousSales } = await readCompanyCustomers(company.id, now);
  const counts = segmentCounts(customers, now);
  const shown = segment ? customers.filter((c) => inSegment(c, segment, now)) : customers;

  const base = `/${locale}/cabinet/companies/${company.id}`;
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <CabinetBackButton locale={locale} />
      <div>
        <Link href={`${base}/g/showcase`} className="text-[12px] text-muted underline">
          ← {company.displayName}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]">🧑 {t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{t("segmentsTitle")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CRM_SEGMENTS.map((key) => {
            const count = counts[key];
            const active = segment === key;
            return (
              <Link
                key={key}
                href={active ? `${base}/customers` : `${base}/customers?segment=${key}`}
                className={`${ADMIN_TILE} block ${active ? "border-accent" : ""}`}
              >
                <div className="text-sm font-semibold">{t(`segment.${key}`)}</div>
                <div className="num mt-1 text-[22px] font-bold">{count.total}</div>
                {/* «Написать можно N» — честная граница сценария удержания: покупка
                    согласием на рекламу не является, и спящему без подписки мы не пишем. */}
                <div className="mt-1 text-[11px] text-muted">{t("reachable", { count: count.reachable })}</div>
              </Link>
            );
          })}
        </div>
        <p className="text-[11px] text-muted">{t("segmentsHint")}</p>
      </section>

      {counts.dormant.total > 0 ? (
        <section className="rounded-[14px] border border-hairline bg-card p-4">
          <p className="text-sm">{t("retention", { count: counts.dormant.total, days: DORMANT_DAYS })}</p>
          <p className="mt-1 text-[11px] text-muted">{t("retentionHint")}</p>
          <Link href={`${base}/promos`} className={`${ADMIN_BUTTON_SECONDARY} mt-3`}>
            {t("retentionAction")}
          </Link>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
            {segment ? t(`segment.${segment}`) : t("listTitle")}
          </h2>
          <span className="text-[11px] text-muted">{t("listCount", { count: shown.length })}</span>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-[14px] border border-hairline bg-card p-4 text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((c) => (
              <li key={c.userId}>
                <Link href={`${base}/customers/${c.userId}`} className={`${ADMIN_TILE} block`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="num text-sm font-semibold">{customerLabel(c)}</span>
                    <span className="text-[11px] text-muted">
                      {c.lastPurchaseAt
                        ? t("lastPurchase", { date: format.dateTime(c.lastPurchaseAt, { dateStyle: "short" }) })
                        : t("noPurchase")}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {t("purchases", { count: c.purchases })}
                    {showMoney && Object.keys(c.turnover).length > 0 ? (
                      <>
                        {" · "}
                        {Object.entries(c.turnover)
                          .map(([currency, sum]) => money(sum, currency))
                          .join(" · ")}
                      </>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {segmentsFor(c, now).map((s) => (
                      <span key={s} className="rounded-full bg-accent/10 px-2 py-[2px] text-[10px] text-accent">
                        {t(`segment.${s}`)}
                      </span>
                    ))}
                    {reachable(c) ? null : (
                      <span className="rounded-full bg-hairline/60 px-2 py-[2px] text-[10px] text-muted">
                        {t("notReachable")}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {truncated ? <p className="text-[11px] text-muted">{t("truncated")}</p> : null}
        {anonymousSales > 0 ? <p className="text-[11px] text-muted">{t("anonymous", { count: anonymousSales })}</p> : null}
        <p className="text-[11px] text-muted">{t("privacy")}</p>
      </section>
    </main>
  );
}
