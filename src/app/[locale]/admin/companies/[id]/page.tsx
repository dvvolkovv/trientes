import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { CaseSection } from "@/components/admin/case-section";
import { CompanySupervision, type SupervisionLabels } from "@/components/admin/company-supervision";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { reviewDueSoon } from "@/lib/company-visibility";

export const dynamic = "force-dynamic";

const REPORT_WINDOW_DAYS = 90;

/**
 * Надзор над залистованным предприятием: три числа, срок пересмотра, связь с
 * владельцем, его объекты и состояние листинга.
 *
 * Разделы и кнопки — те же, что в деле (`CaseSection`, `ADMIN_BUTTON`): админка
 * должна оставаться одним экраном, а не семью разными.
 */
export default async function AdminCompanyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, username: true, email: true } },
      reviewer: { select: { name: true, username: true } },
      points: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          address: true,
          underReviewAt: true,
          suspendedAt: true,
        },
      },
      coinCards: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, slug: true, name: true, symbol: true, status: true },
      },
    },
  });
  if (!company) notFound();

  const c = await prisma.complianceCase.findUnique({
    where: { subjectType_subjectId: { subjectType: "COMPANY", subjectId: company.id } },
    select: { id: true, status: true, risk: true, nextReviewAt: true },
  });

  const now = new Date();
  const since = new Date(now.getTime() - REPORT_WINDOW_DAYS * 86_400_000);
  const [reports, warnings] = await Promise.all([
    company.points.length
      ? prisma.pointReport.count({
          where: { pointId: { in: company.points.map((p) => p.id) }, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
    c
      ? prisma.caseEvent.count({ where: { caseId: c.id, kind: "COMPANY_WARNED" } })
      : Promise.resolve(0),
  ]);

  const onMap = company.points.filter(
    (p) => p.status === "APPROVED" && !p.suspendedAt && p.type !== "ONLINE",
  ).length;
  const suspended = company.suspendedAt !== null;
  const reviewDue = reviewDueSoon(c?.nextReviewAt ?? null, now);
  const fmtDate = (d: Date | null) =>
    d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d) : "—";

  const labels: SupervisionLabels = {
    messagePlaceholder: t("company.contact.placeholder"),
    message: t("company.contact.send"),
    warn: t("company.contact.warn"),
    suspendPlaceholder: t("company.listing.reasonPlaceholder"),
    suspend: t("company.listing.suspend"),
    restore: t("company.listing.restore"),
    passReview: t("company.supervision.passReview"),
    done: t("company.done"),
    errors: {
      reason_too_short: t("company.errors.reason_too_short"),
      not_found: t("company.errors.not_found"),
      failed: t("company.errors.failed"),
      unauth: t("company.errors.failed"),
      no_access: t("company.errors.failed"),
      forbidden: t("company.errors.failed"),
      empty: t("company.errors.reason_too_short"),
      too_long: t("company.errors.failed"),
    },
  };

  const numbers: { label: string; value: string }[] = [
    { label: t("company.numbers.points"), value: String(onMap) },
    { label: t("company.numbers.reports"), value: String(reports) },
    { label: t("company.numbers.warnings"), value: String(warnings) },
  ];

  let sectionNo = 0;
  const nextNo = () => String(++sectionNo);

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="business" />

      <header className="mb-5 text-center">
        <div className="num mb-2 text-[10px] uppercase tracking-[0.3em] text-muted">
          {t("company.kicker")}
        </div>
        <h1 className="mb-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">
          {company.displayName}
        </h1>
        <div className="flex flex-wrap justify-center gap-1.5">
          <span className="rounded-full bg-card-alt px-2 py-1 text-[10px] font-semibold text-muted-strong">
            {company.status}
          </span>
          {suspended ? (
            <span className="rounded-full bg-down/15 px-2 py-1 text-[10px] font-semibold text-down">
              {t("company.listing.suspendedBadge")}
            </span>
          ) : null}
          {reviewDue ? (
            <span className="rounded-full bg-[#e2a33c]/15 px-2 py-1 text-[10px] font-semibold text-[#e2a33c]">
              {t("company.supervision.dueBadge")}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mb-4 grid grid-cols-3 gap-2.5">
        {numbers.map((n) => (
          <div key={n.label} className="rounded-[14px] border border-hairline bg-card p-3">
            <div className="mb-1 text-[9.5px] uppercase leading-tight tracking-[0.18em] text-muted">
              {n.label}
            </div>
            <div className="num text-[18px] font-bold">{n.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 pb-10">
        <CaseSection
          n={nextNo()}
          title={t("company.supervision.title")}
          summary={
            c?.nextReviewAt
              ? t("company.supervision.summary", { date: fmtDate(c.nextReviewAt) })
              : t("company.supervision.summaryNone")
          }
          open
        >
          <dl className="mb-3 flex flex-col">
            {[
              {
                k: t("company.supervision.approvedBy"),
                v: company.reviewer?.name ?? company.reviewer?.username ?? "—",
              },
              { k: t("company.supervision.approvedAt"), v: fmtDate(company.reviewedAt) },
              { k: t("company.supervision.kyb"), v: company.kybStatus },
              { k: t("company.supervision.risk"), v: c ? t(`case.risk.${c.risk}`) : "—" },
              { k: t("company.supervision.nextReview"), v: fmtDate(c?.nextReviewAt ?? null) },
            ].map((row) => (
              <div
                key={row.k}
                className="flex justify-between gap-3 border-b border-hairline py-2 last:border-b-0"
              >
                <dt className="text-[11px] uppercase tracking-wider text-muted">{row.k}</dt>
                <dd className="text-right text-[12.5px]">{row.v}</dd>
              </div>
            ))}
          </dl>
          <CompanySupervision
            companyId={company.id}
            suspended={suspended}
            labels={labels}
            show="review"
          />
        </CaseSection>

        <CaseSection
          n={nextNo()}
          title={t("company.contact.title")}
          summary={
            c ? t("company.contact.summary") : t("company.contact.summaryNoCase")
          }
        >
          <CompanySupervision
            companyId={company.id}
            suspended={suspended}
            labels={labels}
            show="contact"
          />
          {c ? (
            <Link
              href={`/${locale}/admin/cases/${c.id}`}
              className="mt-3 block text-center text-[12px] text-accent underline"
            >
              {t("company.contact.openCase")}
            </Link>
          ) : null}
        </CaseSection>

        <CaseSection
          n={nextNo()}
          title={t("company.objects.title")}
          summary={t("company.objects.summary", {
            points: company.points.length,
            cards: company.coinCards.length,
          })}
        >
          {company.points.length === 0 && company.coinCards.length === 0 ? (
            <p className="text-[12px] text-muted">{t("company.objects.empty")}</p>
          ) : null}
          <ul className="flex flex-col">
            {company.points.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[12.5px] font-medium">{p.name}</b>
                  <span className="block truncate text-[11px] text-muted">{p.address ?? "—"}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <span className="rounded-full bg-card-alt px-2 py-0.5 text-[10px] text-muted-strong">
                    {p.status}
                  </span>
                  {p.suspendedAt ? (
                    <span className="rounded-full bg-down/15 px-2 py-0.5 text-[10px] text-down">
                      {t("company.objects.pointSuspended")}
                    </span>
                  ) : p.underReviewAt ? (
                    <span className="rounded-full bg-[#e2a33c]/15 px-2 py-0.5 text-[10px] text-[#e2a33c]">
                      {t("company.objects.pointUnderReview")}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
            {company.coinCards.map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-b-0"
              >
                <Link
                  href={`/${locale}/coin/${card.slug}`}
                  className="min-w-0 flex-1 truncate text-[12.5px] font-medium hover:text-accent"
                >
                  {card.name} · {card.symbol}
                </Link>
                <span className="shrink-0 rounded-full bg-card-alt px-2 py-0.5 text-[10px] text-muted-strong">
                  {card.status}
                </span>
              </li>
            ))}
          </ul>
        </CaseSection>

        <CaseSection
          n={nextNo()}
          title={t("company.listing.title")}
          summary={
            suspended
              ? t("company.listing.summarySuspended", {
                  reason: company.suspendReason ?? "—",
                })
              : t("company.listing.summaryLive")
          }
          open={suspended}
        >
          {suspended ? (
            <p className="mb-3 text-[12.5px] leading-snug">
              {t("company.listing.suspendedAt", { date: fmtDate(company.suspendedAt) })}
              {company.suspendReason ? ` — ${company.suspendReason}` : ""}
            </p>
          ) : (
            <p className="mb-3 text-[12px] leading-snug text-muted">
              {t("company.listing.hint")}
            </p>
          )}
          <CompanySupervision
            companyId={company.id}
            suspended={suspended}
            labels={labels}
            show="listing"
          />
        </CaseSection>
      </div>
    </div>
  );
}
