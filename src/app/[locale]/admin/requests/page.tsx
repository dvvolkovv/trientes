import { notFound } from "next/navigation";
import { requireQueue } from "@/lib/authz/guard";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { RequestRow, type RequestRowData } from "@/components/admin/request-row";
import { QueueMoved } from "@/components/admin/queue-moved";
import { AdminFilterTabs } from "@/components/admin/filter-tabs";
import { statusFilterHex } from "@/lib/admin-sections";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage({
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
  if (!(await requireQueue("coinRequests", "VIEW")).ok) notFound();

  const t = await getTranslations("admin");

  const tk = await getTranslations("common");
  const statusFilter =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  // Ожидающие заявки решаются в деле, а не здесь: см. QueueMoved.
  const requests = statusFilter === "PENDING" ? [] : await prisma.coinRequest.findMany({
    where: { status: statusFilter },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { email: true } } },
  });

  const rows: RequestRowData[] = requests.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    name: r.name,
    symbol: r.symbol,
    coingeckoId: r.coingeckoId,
    reason: r.reason,
    status: r.status,
    rejectReason: r.rejectReason,
    userEmail: r.user?.email ?? null,
  }));

  return (
    <>
      <AdminNav locale={locale} active="requests" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">
          {tk("kicker.admin")}
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("requests.title")}
        </h1>
        <p className="text-muted">{t("requests.subtitle")}</p>
      </header>
      <AdminFilterTabs
        groups={[
          (["pending", "approved", "rejected"] as const).map((s) => ({
            key: s,
            href: s === "pending" ? "?" : `?tab=${s}`,
            label: t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`),
            active: statusFilter === s.toUpperCase(),
            colorHex: statusFilterHex(s),
          })),
        ]}
      />
      {statusFilter === "PENDING" ? <QueueMoved locale={locale} queue="coinRequests" /> : null}
      {statusFilter === "PENDING" ? null : rows.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
          {t("requests.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <RequestRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}
