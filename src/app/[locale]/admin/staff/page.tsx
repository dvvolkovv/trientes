import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { buildStaffStats, type StaffCaseRow } from "@/lib/cases/staff-stats";
import { formatHandled } from "@/lib/cases/time";
import { ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

type Window = "30d" | "90d" | "all";

const WINDOW_DAYS: Record<Window, number | null> = { "30d": 30, "90d": 90, all: null };

function asWindow(raw: string | undefined): Window {
  return raw === "90d" || raw === "all" ? raw : "30d";
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export default async function AdminStaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ w?: string }>;
}) {
  const { locale } = await params;
  const { w } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const win = asWindow(w);
  const days = WINDOW_DAYS[win];
  const since = days === null ? null : new Date(Date.now() - days * 86400000);
  const decidedFilter = since ? { gte: since } : { not: null };

  const [cases, resubmitRows] = await Promise.all([
    prisma.complianceCase.findMany({
      // Только настоящие решения. Дело, закрытое потому, что объект решили вне
      // дела, решением сотрудника не является и в его числа не идёт.
      where: { decidedAt: decidedFilter, decision: { not: null } },
      select: {
        reviewedById: true,
        assigneeId: true,
        approvedById: true,
        decision: true,
        soleSignOff: true,
        handledSeconds: true,
        openedAt: true,
        firstResponseAt: true,
        decidedAt: true,
        dueAt: true,
      },
    }),
    prisma.caseDocument.groupBy({
      by: ["verdictById"],
      where: { verdict: "RESUBMIT", verdictAt: decidedFilter },
      _count: { _all: true },
    }),
  ]);

  const resubmitsByUser = new Map<string, number>();
  for (const row of resubmitRows) {
    if (row.verdictById) resubmitsByUser.set(row.verdictById, row._count._all);
  }

  const { stats, unattributed } = buildStaffStats(cases as StaffCaseRow[], resubmitsByUser);

  const people = await prisma.user.findMany({
    where: { id: { in: stats.map((s) => s.userId) } },
    select: { id: true, name: true, username: true, email: true },
  });
  const nameById = new Map(
    people.map((p) => [p.id, p.name ?? p.username ?? p.email ?? p.id.slice(0, 6)]),
  );

  const cols = (s: (typeof stats)[number]) => [
    { label: t("staff.cols.decided"), value: String(s.decided) },
    { label: t("staff.cols.approved"), value: String(s.approved) },
    { label: t("staff.cols.rejected"), value: String(s.rejected) },
    { label: t("staff.cols.rejectShare"), value: s.decided > 0 ? pct(s.rejectShare) : "—" },
    { label: t("staff.cols.avgHandled"), value: s.decided > 0 ? formatHandled(s.avgHandledSeconds) : "—" },
    {
      label: t("staff.cols.avgFirstResponse"),
      value: s.avgFirstResponseSeconds === null ? "—" : formatHandled(s.avgFirstResponseSeconds),
    },
    { label: t("staff.cols.overdue"), value: String(s.overdue) },
    { label: t("staff.cols.secondSignatures"), value: String(s.secondSignatures) },
    { label: t("staff.cols.soleSignOffs"), value: String(s.soleSignOffs) },
    { label: t("staff.cols.resubmits"), value: String(s.resubmits) },
  ];

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="staff" />
      <header className="mb-6 text-center">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">
          {t("tabs.staff")}
        </div>
        <h1 className="mb-1 text-[32px] font-bold tracking-[-0.03em]">{t("staff.title")}</h1>
        <p className="text-sm text-muted">
          {t("staff.subtitle", { window: t(`staff.windows.${win}`) })}
        </p>
      </header>

      <div className="mb-5 flex justify-center gap-2">
        {(["30d", "90d", "all"] as const).map((key) => (
          <Link
            key={key}
            href={key === "30d" ? "?" : `?w=${key}`}
            className={
              win === key
                ? "rounded-full bg-foreground px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-bg"
                : "rounded-full border border-hairline bg-card px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
            }
          >
            {t(`staff.windows.${key}`)}
          </Link>
        ))}
      </div>

      {stats.length === 0 ? (
        <div className="rounded-[20px] border border-hairline bg-card p-8 text-center text-muted">
          {t("staff.empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stats.map((s) => (
            <div key={s.userId} className="rounded-[20px] border border-hairline bg-card p-4">
              <b className="mb-3 block text-[15px] font-semibold">{nameById.get(s.userId)}</b>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 md:grid-cols-5">
                {cols(s).map((col) => (
                  <div key={col.label}>
                    <div className="text-[9.5px] uppercase tracking-[0.15em] text-muted">
                      {col.label}
                    </div>
                    <div className="text-[14px] font-semibold">{col.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-[11px] leading-snug text-muted">{t("staff.hint")}</p>
      {unattributed > 0 ? (
        <p className="mt-1.5 text-center text-[11px] leading-snug text-muted">
          {t("staff.unattributed", { count: unattributed })}
        </p>
      ) : null}
    </div>
  );
}
