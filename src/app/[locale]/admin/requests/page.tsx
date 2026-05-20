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
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("requests.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("requests.subtitle")}</p>
      </header>
      <div className="flex gap-2 mb-4">
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
              className={`px-3 py-1 text-sm rounded ${
                active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`)}
            </a>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("requests.empty")}</p>
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
