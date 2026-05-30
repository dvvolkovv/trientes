import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { PointRow, type PointRowData } from "@/components/admin/point-row";
import { CompanyRow, type CompanyRowData } from "@/components/admin/company-row";

export const dynamic = "force-dynamic";

type Scope = "companies" | "points";

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

  const t = await getTranslations("admin");
  const scope: Scope = scopeParam === "points" ? "points" : "companies";
  const status =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const tabsRow = (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <div className="flex gap-2">
        {(["companies", "points"] as const).map((s) => {
          const active = scope === s;
          const href = s === "companies" ? "?" : `?scope=${s}`;
          return (
            <a key={s} href={href}
              className={
                active
                  ? "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-accent/15 text-accent"
                  : "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-card text-muted hover:text-foreground border border-hairline"
              }>
              {t(`business.scope.${s}`)}
            </a>
          );
        })}
      </div>
      <div className="ml-auto flex gap-2">
        {(["pending", "approved", "rejected"] as const).map((s) => {
          const active = status.toLowerCase() === s;
          const params = new URLSearchParams();
          if (scope === "points") params.set("scope", "points");
          if (s !== "pending") params.set("tab", s);
          const href = params.toString() ? `?${params.toString()}` : "?";
          return (
            <a key={s} href={href}
              className={
                active
                  ? "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-foreground text-bg"
                  : "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-card text-muted hover:text-foreground border border-hairline"
              }>
              {t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`)}
            </a>
          );
        })}
      </div>
    </div>
  );

  if (scope === "points") {
    const points = await prisma.companyPoint.findMany({
      where: { status }, orderBy: { createdAt: "desc" }, take: 50,
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
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">Admin</div>
          <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("business.title")}</h1>
          <p className="text-muted">{t("business.subtitle")}</p>
        </header>
        {tabsRow}
        {rows.length === 0 ? (
          <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
            {t("business.empty")}
          </div>
        ) : (
          <div className="space-y-3">{rows.map((r) => <PointRow key={r.id} row={r} />)}</div>
        )}
      </>
    );
  }

  const companies = await prisma.company.findMany({
    where: { status }, orderBy: { createdAt: "desc" }, take: 100,
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
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">Admin</div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("companies.title")}</h1>
        <p className="text-muted">{t("companies.subtitle")}</p>
      </header>
      {tabsRow}
      {rows.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
          {t("companies.empty")}
        </div>
      ) : (
        <div className="space-y-3">{rows.map((r) => <CompanyRow key={r.id} row={r} />)}</div>
      )}
    </>
  );
}
