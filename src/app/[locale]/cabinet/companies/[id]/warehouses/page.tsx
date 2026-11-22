import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { readMovements, readShelfPoints, readWarehouses } from "@/lib/warehouse/read";
import { WarehouseCreateForm } from "@/components/warehouse/warehouse-create-form";
import { TransitList } from "@/components/warehouse/transit-list";
import { CabinetBackButton } from "@/components/cabinet/company-back";

export const dynamic = "force-dynamic";

/** Склады предприятия: оптовый, полки (точка или онлайн) и сторонние. */
export default async function CompanyWarehousesPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("warehouses");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "warehouses")) notFound();
  const editable = canEditSection(permissions, "warehouses");

  const [rows, points, transit] = await Promise.all([
    readWarehouses(company.id, pointScope),
    readShelfPoints(company.id, pointScope),
    readMovements(company.id, { status: "IN_TRANSIT", take: 50, scope: pointScope }),
  ]);
  const listed = company.status === "APPROVED" && !company.suspendedAt;

  return (
    <main className="max-w-[900px] mx-auto px-4 md:px-12 py-10">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h1>
        <p className="text-muted text-sm">{t("subtitle")}</p>
      </header>

      {!listed ? (
        <p className="text-sm text-muted border border-hairline rounded-md p-3 mb-6">{t("notListed")}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted text-sm mb-6">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-8">
          {rows.map((w) => (
            <li key={w.id} className="border border-hairline rounded-lg p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {w.name}
                  {w.archivedAt ? <span className="text-muted"> · {t("archived")}</span> : null}
                </div>
                <div className="text-[11px] text-muted">
                  {t(`kinds.${w.kind}`)}
                  {w.pointName ? ` · ${w.pointName}` : w.online ? ` · ${t("onlineShelf")}` : null}
                  {w.countryCode ? ` · ${w.countryCode}` : null}
                </div>
                <div className="text-[11px] text-muted num">
                  {t("positions", { count: w.positions })} · {t("totalQty", { qty: w.totalQty })}
                </div>
              </div>
              <Link
                href={`/${locale}/cabinet/companies/${company.id}/warehouses/${w.id}`}
                className="h-12 px-4 rounded-md border border-hairline text-sm flex items-center shrink-0"
              >
                {t("open")}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {editable && listed ? (
        <div className="mb-8">
          <WarehouseCreateForm companyId={company.id} points={points} scoped={pointScope.length > 0} />
        </div>
      ) : null}

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("transitHeading")}</h2>
        {editable ? (
          <TransitList
            companyId={company.id}
            rows={transit.map((m) => ({
              id: m.id,
              productName: m.productName,
              qty: m.qty,
              fromName: m.fromName,
              toName: m.toName,
              carrierName: m.carrierName,
              trackingCode: m.trackingCode,
              expectedAt: m.expectedAt ? m.expectedAt.toISOString().slice(0, 10) : null,
            }))}
          />
        ) : transit.length === 0 ? (
          <p className="text-sm text-muted">{t("transitEmpty")}</p>
        ) : (
          <ul className="text-sm text-muted">
            {transit.map((m) => (
              <li key={m.id} className="num">
                {m.productName} · {m.qty}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
