import { notFound } from "next/navigation";
import { requireQueue } from "@/lib/authz/guard";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { ExchangeRow, type ExchangeRowData } from "@/components/admin/exchange-row";
import { QueueMoved } from "@/components/admin/queue-moved";
import { AdminFilterTiles } from "@/components/admin/filter-tiles";
import { statusFilterHex } from "@/lib/section-colors";

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
  // История решений по своей очереди: нет доступа — нет страницы.
  if (!(await requireQueue("exchanges", "VIEW")).ok) notFound();

  const t = await getTranslations("admin");

  const tk = await getTranslations("common");
  const status =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const exchanges = status === "PENDING" ? [] : await prisma.registeredExchange.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { owner: { select: { username: true } } },
  });

  const counts = await prisma.registeredExchange.groupBy({ by: ["status"], _count: { _all: true } });
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

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
          {tk("kicker.admin")}
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("exchanges.title")}
        </h1>
        <p className="text-muted">{t("exchanges.subtitle")}</p>
      </header>
      <AdminFilterTiles
        groups={[
          (["pending", "approved", "rejected"] as const).map((s) => ({
            key: s,
            href: s === "pending" ? "?" : `?tab=${s}`,
            label: t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`),
            active: status === s.toUpperCase(),
            count: countOf(s.toUpperCase()),
            colorHex: statusFilterHex(s),
          })),
        ]}
      />
      {status === "PENDING" ? <QueueMoved locale={locale} queue="exchanges" /> : null}
      {status === "PENDING" ? null : rows.length === 0 ? (
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
