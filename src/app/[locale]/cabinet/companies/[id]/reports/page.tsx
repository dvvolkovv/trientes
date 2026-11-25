import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { readReportSales, reportTimezone, REPORT_MAX_SALES } from "@/lib/reports/read";
import { aggregateSales } from "@/lib/reports/aggregate";
import { REPORT_RANGES, resolvePeriod, type ReportRange } from "@/lib/reports/period";
import { readApiKeys } from "@/lib/merchant-api/read";
import { ApiKeysPanel } from "@/components/reports/api-keys-panel";
import { ReportPeriodForm } from "@/components/reports/period-form";
import { CabinetBackButton } from "@/components/cabinet/back-button";
import { ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

/**
 * Отчётность предприятия (слайс CL, ТЗ 6.4). Сводка по чекам кассы, выгрузка файлом для
 * налогового консультанта и ключи read-only API для учётной системы мерчанта.
 *
 * Чего на экране нет и почему: **комиссий** (своей комиссии с продажи мы не берём, а
 * нулевой столбец читался бы как измеренный ноль) и **единого итога поверх валют**
 * (курса сделки мы не наблюдали — разбор CK).
 */
export default async function CompanyReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetReports");
  const { userId, company, role, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "reports")) notFound();
  const canExport = canEditSection(permissions, "reports");
  const isOwner = role === "OWNER";

  const one = (key: string) => (Array.isArray(query[key]) ? query[key]?.[0] : query[key]) ?? null;

  const { tz, mixed } = await reportTimezone(company.id);
  const period = resolvePeriod({ range: one("range"), from: one("from"), to: one("to"), tz });
  const { sales, truncated } = await readReportSales(company.id, {
    from: period.from,
    to: period.to,
    scope: pointScope,
  });
  const summary = aggregateSales(sales, tz, { truncated });
  const keys = isOwner ? await readApiKeys(company.id) : [];

  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );

  const exportHref = (kind: "receipts" | "lines") =>
    `/api/company-report/${company.id}/export?kind=${kind}&range=custom&from=${period.fromDay}&to=${period.toDay}`;

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

      <header className="mb-5">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="mt-1 text-[13px] leading-snug text-muted">{t("subtitle")}</p>
      </header>

      <ReportPeriodForm
        basePath={`/${locale}/cabinet/companies/${company.id}/reports`}
        range={period.range}
        fromDay={period.fromDay}
        toDay={period.toDay}
        labels={{
          ranges: Object.fromEntries(
            REPORT_RANGES.map((r) => [r, t(`range.${r}` as never)]),
          ) as Record<ReportRange, string>,
          from: t("fromLabel"),
          to: t("toLabel"),
          apply: t("apply"),
        }}
      />

      <p className="mt-3 text-[12px] leading-snug text-muted">
        {t("timezoneNote", { tz })}
        {mixed ? ` ${t("timezoneMixed")}` : ""}
      </p>

      {truncated ? (
        <p className="mt-3 rounded-[12px] border border-down/40 bg-card p-3 text-[12.5px] leading-snug text-down">
          {t("truncated", { max: REPORT_MAX_SALES })}
        </p>
      ) : null}

      {summary.currencies.length === 0 ? (
        <p className="mt-6 text-[13px] text-muted">{t("empty")}</p>
      ) : (
        summary.currencies.map((c) => (
          <section key={c.currency} className="mt-7">
            <h2 className="mb-3 text-[12px] uppercase tracking-[0.2em] text-muted">
              {t("currencyHeading", { currency: c.currency })}
            </h2>

            <dl className="grid grid-cols-2 gap-2">
              {[
                { key: "receipts", value: String(c.receipts) },
                { key: "revenue", value: money(c.revenue, c.currency) },
                { key: "listTotal", value: money(c.listTotal, c.currency) },
                { key: "discount", value: money(c.discount, c.currency) },
                { key: "cashback", value: money(c.cashback, c.currency) },
                {
                  key: "cancelled",
                  value: `${c.cancelledCount} · ${money(c.cancelledTotal, c.currency)}`,
                },
              ].map((cell) => (
                <div key={cell.key} className="rounded-[12px] border border-hairline bg-card p-3">
                  <dt className="text-[11.5px] leading-snug text-muted">{t(`metric.${cell.key}` as never)}</dt>
                  <dd className="mt-1 text-[15px] font-semibold num">{cell.value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("cashbackNote")}</p>
            <p className="mt-1 text-[11.5px] leading-snug text-muted">{t("feesNote")}</p>

            {[
              { heading: t("byDay"), rows: c.byDay.map((d) => ({ label: dayLabel(d.day), extra: String(d.receipts), value: d.revenue })) },
              { heading: t("byPayment"), rows: c.byPayment.map((b) => ({ label: t(`payment.${b.key}` as never), extra: String(b.receipts), value: b.revenue })) },
              { heading: t("byPoint"), rows: c.byPoint.map((b) => ({ label: b.label || t("noPoint"), extra: String(b.receipts), value: b.revenue })) },
              { heading: t("byCashier"), rows: c.byCashier.map((b) => ({ label: b.label || t("noCashier"), extra: String(b.receipts), value: b.revenue })) },
              { heading: t("topProducts"), rows: c.topProducts.map((p) => ({ label: p.label, extra: String(p.qty), value: p.revenue })) },
            ].map((block) =>
              block.rows.length === 0 ? null : (
                <div key={block.heading} className="mt-5">
                  <h3 className="mb-2 text-[12.5px] font-semibold">{block.heading}</h3>
                  <ul className="flex flex-col gap-1">
                    {block.rows.map((row, index) => (
                      <li
                        key={`${row.label}-${index}`}
                        className="flex min-h-10 items-center gap-2 rounded-[10px] border border-hairline bg-card px-3 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{row.label}</span>
                        <span className="shrink-0 text-[11.5px] text-muted num">{row.extra}</span>
                        <span className="shrink-0 text-[12.5px] num">{money(row.value, c.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </section>
        ))
      )}

      <section className="mt-9">
        <h2 className="mb-2 text-[12px] uppercase tracking-[0.2em] text-muted">{t("exportHeading")}</h2>
        <p className="mb-3 text-[12.5px] leading-snug text-muted">{t("exportHint")}</p>
        {canExport ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <a className={ADMIN_BUTTON_SECONDARY} href={exportHref("receipts")}>
              {t("exportReceipts")}
            </a>
            <a className={ADMIN_BUTTON_SECONDARY} href={exportHref("lines")}>
              {t("exportLines")}
            </a>
          </div>
        ) : (
          <p className="rounded-[12px] border border-hairline bg-card p-3 text-[12.5px] leading-snug text-muted">
            {t("exportForbidden")}
          </p>
        )}
      </section>

      {isOwner ? (
        <ApiKeysPanel
          companyId={company.id}
          keys={keys.map((k) => ({
            id: k.id,
            name: k.name,
            prefix: k.prefix,
            createdAt: k.createdAt.toISOString(),
            lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
            revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
            revokeReason: k.revokeReason,
          }))}
          locale={locale}
        />
      ) : null}
    </main>
  );
}
