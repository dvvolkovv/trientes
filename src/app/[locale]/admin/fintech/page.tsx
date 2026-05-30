import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { AdminFintechRow, type AdminFintechRowData } from "@/components/fintech/admin-fintech-row";

export const dynamic = "force-dynamic";

export default async function AdminFintechPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const status =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const rows = await prisma.fintechCompany.findMany({
    where: { status },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { owner: { select: { email: true } } },
  });

  const data: AdminFintechRowData[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    status: r.status,
    source: r.source,
    services: r.services as string[],
    availableIn: r.availableIn,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    ownerEmail: r.owner?.email ?? null,
  }));

  return (
    <>
      <AdminNav locale={locale} active="fintech" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">Admin</div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("fintech.admin.title")}</h1>
        <p className="text-muted">{t("fintech.admin.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="ml-auto flex gap-2">
          {(["pending", "approved", "rejected"] as const).map((s) => {
            const active = status.toLowerCase() === s;
            const href = s === "pending" ? "?" : `?tab=${s}`;
            return (
              <a key={s} href={href}
                className={
                  active
                    ? "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-foreground text-bg"
                    : "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-card text-muted hover:text-foreground border border-hairline"
                }>
                {t(`admin.status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`)}
              </a>
            );
          })}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
          {t("fintech.admin.empty")}
        </div>
      ) : (
        <div className="space-y-3">{data.map((r) => <AdminFintechRow key={r.id} row={r} />)}</div>
      )}
    </>
  );
}
