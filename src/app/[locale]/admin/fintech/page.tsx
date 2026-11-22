import { notFound } from "next/navigation";
import { requireQueue } from "@/lib/authz/guard";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { AdminFintechRow, type AdminFintechRowData } from "@/components/fintech/admin-fintech-row";
import { QueueMoved } from "@/components/admin/queue-moved";
import { AdminFilterTabs } from "@/components/admin/filter-tabs";
import { statusFilterHex } from "@/lib/admin-sections";

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
  // История решений по своей очереди: нет доступа — нет страницы.
  if (!(await requireQueue("fintech", "VIEW")).ok) notFound();
  const t = await getTranslations();
  const tk = await getTranslations("common");

  const status =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const rows = status === "PENDING" ? [] : await prisma.fintechCompany.findMany({
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
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">{tk("kicker.admin")}</div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("fintech.admin.title")}</h1>
        <p className="text-muted">{t("fintech.admin.subtitle")}</p>
      </header>

      <AdminFilterTabs
        groups={[
          (["pending", "approved", "rejected"] as const).map((s) => ({
            key: s,
            href: s === "pending" ? "?" : `?tab=${s}`,
            label: t(`admin.status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`),
            active: status === s.toUpperCase(),
            colorHex: statusFilterHex(s),
          })),
        ]}
      />

      {status === "PENDING" ? <QueueMoved locale={locale} queue="fintech" /> : null}
      {status === "PENDING" ? null : data.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
          {t("fintech.admin.empty")}
        </div>
      ) : (
        <div className="space-y-3">{data.map((r) => <AdminFintechRow key={r.id} row={r} />)}</div>
      )}
    </>
  );
}
