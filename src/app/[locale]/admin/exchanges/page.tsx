import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { ExchangeRow, type ExchangeRowData } from "@/components/admin/exchange-row";

export const dynamic = "force-dynamic";

export default async function AdminExchangesPage({
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

  const exchanges = await prisma.registeredExchange.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { owner: { select: { username: true } } },
  });

  const rows: ExchangeRowData[] = exchanges.map((x) => ({
    id: x.id,
    displayName: x.displayName,
    legalName: x.legalName,
    ownerUsername: x.owner.username ?? "—",
    country: x.country,
    website: x.website,
    email: x.email,
    logoUrl: x.logoUrl,
    status: x.status,
    rejectionReason: x.rejectionReason,
    createdAt: x.createdAt.toISOString(),
  }));

  return (
    <>
      <AdminNav locale={locale} active="exchanges" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">
          Admin
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("exchanges.title")}
        </h1>
        <p className="text-muted">{t("exchanges.subtitle")}</p>
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
          {t("exchanges.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ExchangeRow key={r.id} row={r} />
          ))}
        </div>
      )}
    </>
  );
}
