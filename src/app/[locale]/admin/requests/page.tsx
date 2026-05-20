import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { RequestRow, type RequestRowData } from "@/components/admin/request-row";

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

  const t = await getTranslations("admin");
  const statusFilter =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const requests = await prisma.coinRequest.findMany({
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
          Admin
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("requests.title")}
        </h1>
        <p className="text-muted">{t("requests.subtitle")}</p>
      </header>
      <div className="flex gap-2 mb-6">
        {(["pending", "approved", "rejected"] as const).map((s) => {
          const active =
            (statusFilter === "PENDING" && s === "pending") ||
            (statusFilter === "APPROVED" && s === "approved") ||
            (statusFilter === "REJECTED" && s === "rejected");
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
              {t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`)}
            </a>
          );
        })}
      </div>
      {rows.length === 0 ? (
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
