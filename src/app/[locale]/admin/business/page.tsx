import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { PointRow, type PointRowData } from "@/components/admin/point-row";

export const dynamic = "force-dynamic";

export default async function AdminBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("admin");
  const status =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const points = await prisma.companyPoint.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { company: { select: { displayName: true } } },
  });

  const rows: PointRowData[] = points.map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    lat: p.lat,
    lon: p.lon,
    address: p.address,
    acceptedCoinIds: p.acceptedCoinIds,
    status: p.status,
    rejectReason: p.rejectReason,
    createdAt: p.createdAt.toISOString(),
    companyName: p.company.displayName,
    website: p.website,
  }));

  return (
    <>
      <AdminNav locale={locale} active="business" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">
          Admin
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("business.title")}
        </h1>
        <p className="text-muted">{t("business.subtitle")}</p>
      </header>
      <div className="flex gap-2 mb-6">
        {(["pending", "approved", "rejected"] as const).map((s) => {
          const active = status.toLowerCase() === s;
          const href = s === "pending" ? "?" : `?tab=${s}`;
          return (
            <a
              key={s}
              href={href}
              className={
                active
                  ? "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-foreground text-bg"
                  : "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-card text-muted hover:text-foreground border border-hairline"
              }
            >
              {t(
                `status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`,
              )}
            </a>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
          {t("business.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <PointRow key={r.id} row={r} />
          ))}
        </div>
      )}
    </>
  );
}
