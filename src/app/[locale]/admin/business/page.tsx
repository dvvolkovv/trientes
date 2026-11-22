import { notFound } from "next/navigation";
import { requireAnyQueue } from "@/lib/authz/guard";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { AdminFilterTiles } from "@/components/admin/filter-tiles";
import { statusFilterHex } from "@/lib/section-colors";
import { PointRow, type PointRowData } from "@/components/admin/point-row";
import { CompanyRow, type CompanyRowData } from "@/components/admin/company-row";
import { KybRow } from "@/components/admin/kyb-row";
import { LIVE_POINT, NOT_DELETED } from "@/lib/soft-delete";
import { RestoreRow } from "@/components/admin/restore-row";
import { QueueMoved } from "@/components/admin/queue-moved";

export const dynamic = "force-dynamic";

type Scope = "companies" | "points" | "kyb" | "deleted";

export default async function AdminBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; scope?: string }>;
}) {
  const { locale } = await params;
  const { tab, scope: scopeParam } = await searchParams;
  setRequestLocale(locale);
  // Один экран на три очереди: предприятия, точки и KYB.
  if (!(await requireAnyQueue(["companies", "points", "kyb"], "VIEW")).ok) notFound();

  const t = await getTranslations("admin");

  const tk = await getTranslations("common");
  const scope: Scope =
    scopeParam === "points" ? "points"
    : scopeParam === "kyb" ? "kyb"
    : scopeParam === "deleted" ? "deleted"
    : "companies";
  const status =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  // Числа на плитках считаются одним заходом: область показывает, сколько в ней
  // записей текущего состояния, состояние — сколько их в текущей области.
  const [companyCounts, pointCounts, kybCounts, deletedCompanies, deletedPoints] =
    await Promise.all([
      prisma.company.groupBy({ by: ["status"], where: NOT_DELETED, _count: { _all: true } }),
      prisma.companyPoint.groupBy({ by: ["status"], where: LIVE_POINT, _count: { _all: true } }),
      prisma.company.groupBy({ by: ["kybStatus"], where: NOT_DELETED, _count: { _all: true } }),
      prisma.company.count({ where: { deletedAt: { not: null } } }),
      prisma.companyPoint.count({ where: { deletedAt: { not: null } } }),
    ]);
  const countIn = (s: Scope, st: string): number => {
    if (s === "deleted") return deletedCompanies + deletedPoints;
    if (s === "points") return pointCounts.find((c) => c.status === st)?._count._all ?? 0;
    if (s === "kyb") return kybCounts.find((c) => c.kybStatus === st)?._count._all ?? 0;
    return companyCounts.find((c) => c.status === st)?._count._all ?? 0;
  };

  const tabsRow = (
    <AdminFilterTiles
      groups={[
        (["companies", "points", "kyb", "deleted"] as const).map((s) => ({
          key: s,
          href: s === "companies" ? "?" : `?scope=${s}`,
          label: t(`business.scope.${s}`),
          active: scope === s,
          count: countIn(s, status),
        })),
        // У удалённых записей состояния нет — страница его и не читает; три
        // плитки с одним и тем же числом говорили бы неправду.
        scope === "deleted" ? [] : (["pending", "approved", "rejected"] as const).map((s) => {
          const params = new URLSearchParams();
          if (scope === "points") params.set("scope", "points");
          if (scope === "kyb") params.set("scope", "kyb");
          if (s !== "pending") params.set("tab", s);
          return {
            key: s,
            href: params.toString() ? `?${params.toString()}` : "?",
            label: t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`),
            active: status === s.toUpperCase(),
            count: countIn(scope, s.toUpperCase()),
            colorHex: statusFilterHex(s),
          };
        }),
      ]}
    />
  );

  if (scope === "deleted") {
    // Мягко удалённые записи: данные в базе, но нигде не показываются.
    const [companies, points] = await Promise.all([
      prisma.company.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
        select: { id: true, displayName: true, legalName: true, deletedAt: true },
      }),
      prisma.companyPoint.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
        select: { id: true, name: true, address: true, deletedAt: true, company: { select: { displayName: true } } },
      }),
    ]);
    const restore = t("business.restore");
    return (
      <main className="max-w-[1100px] mx-auto px-4 md:px-12 py-12">
        <h1 className="text-[32px] font-bold tracking-[-0.03em] mb-1">{t("business.title")}</h1>
        <p className="text-muted mb-6">{t("business.deletedSubtitle")}</p>
        {tabsRow}
        {companies.length === 0 && points.length === 0 ? (
          <p className="text-muted">{t("business.deletedEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {companies.map((c) => (
              <RestoreRow
                key={c.id} kind="company" id={c.id} title={c.displayName}
                subtitle={c.legalName} label={restore}
                deletedAt={c.deletedAt!.toISOString().slice(0, 16).replace("T", " ")}
              />
            ))}
            {points.map((p) => (
              <RestoreRow
                key={p.id} kind="point" id={p.id} title={p.name}
                subtitle={[p.company.displayName, p.address].filter(Boolean).join(" · ")}
                label={restore}
                deletedAt={p.deletedAt!.toISOString().slice(0, 16).replace("T", " ")}
              />
            ))}
          </div>
        )}
      </main>
    );
  }

  if (scope === "kyb") {
    const kybStatus =
      tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";
    const companies = kybStatus === "PENDING" ? [] : await prisma.company.findMany({
      where: { kybStatus, ...NOT_DELETED },
      orderBy: { kybSubmittedAt: "desc" },
      take: 100,
      include: { owner: { select: { username: true, email: true } } },
    });
    return (
      <>
        <AdminNav locale={locale} active="business" />
        <header className="mb-8">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">{tk("kicker.admin")}</div>
          <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("business.kyb.title")}</h1>
          <p className="text-muted">{t("business.kyb.subtitle")}</p>
        </header>
        {tabsRow}
        {kybStatus === "PENDING" ? <QueueMoved locale={locale} queue="kyb" /> : null}
        {kybStatus === "PENDING" ? null : companies.length === 0 ? (
          <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
            {t("business.empty")}
          </div>
        ) : (
          <div className="space-y-3">
            {companies.map((c) => (
              <KybRow
                key={c.id}
                companyId={c.id}
                displayName={c.displayName}
                legalName={c.legalName}
                ownerHandle={c.owner.username ?? c.owner.email ?? "—"}
                status={c.kybStatus}
                documents={c.kybDocuments}
                submittedAt={c.kybSubmittedAt ? c.kybSubmittedAt.toISOString() : null}
                rejectionReason={c.kybRejectionReason}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  if (scope === "points") {
    const points = status === "PENDING" ? [] : await prisma.companyPoint.findMany({
      where: { status, ...LIVE_POINT }, orderBy: { createdAt: "desc" }, take: 50,
      include: { company: { select: { displayName: true } } },
    });
    const rows: PointRowData[] = points.map((p) => ({
      id: p.id, type: p.type, name: p.name, description: p.description,
      lat: p.lat, lon: p.lon, address: p.address,
      acceptedCoinIds: p.acceptedCoinIds, status: p.status, rejectReason: p.rejectReason,
      createdAt: p.createdAt.toISOString(), companyName: p.company.displayName,
      website: p.website,
    }));
    return (
      <>
        <AdminNav locale={locale} active="business" />
        <header className="mb-8">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">{tk("kicker.admin")}</div>
          <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("business.title")}</h1>
          <p className="text-muted">{t("business.subtitle")}</p>
        </header>
        {tabsRow}
        {status === "PENDING" ? <QueueMoved locale={locale} queue="points" /> : null}
        {status === "PENDING" ? null : rows.length === 0 ? (
          <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
            {t("business.empty")}
          </div>
        ) : (
          <div className="space-y-3">{rows.map((r) => <PointRow key={r.id} row={r} />)}</div>
        )}
      </>
    );
  }

  const companies = status === "PENDING" ? [] : await prisma.company.findMany({
    where: { status, ...NOT_DELETED }, orderBy: { createdAt: "desc" }, take: 100,
    include: { owner: { select: { username: true } } },
  });
  const rows: CompanyRowData[] = companies.map((c) => ({
    id: c.id, displayName: c.displayName, legalName: c.legalName,
    ownerUsername: c.owner.username ?? "—",
    country: c.country, website: c.website, email: c.email, logoUrl: c.logoUrl,
    address: c.address, status: c.status, rejectionReason: c.rejectionReason,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <>
      <AdminNav locale={locale} active="business" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">{tk("kicker.admin")}</div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("companies.title")}</h1>
        <p className="text-muted">{t("companies.subtitle")}</p>
      </header>
      {tabsRow}
      {status === "PENDING" ? <QueueMoved locale={locale} queue="companies" /> : null}
      {status === "PENDING" ? null : rows.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
          {t("companies.empty")}
        </div>
      ) : (
        <div className="space-y-3">{rows.map((r) => <CompanyRow key={r.id} row={r} />)}</div>
      )}
    </>
  );
}
