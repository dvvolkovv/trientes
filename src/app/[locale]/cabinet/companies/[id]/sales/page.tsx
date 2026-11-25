import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { readSales, readShelfStock, readTillProducts } from "@/lib/sales/read";
import { readWarehouses } from "@/lib/warehouse/read";
import { saleRightsFor } from "@/lib/sales/rules";
import { TillForm } from "@/components/sales/till-form";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Касса предприятия (ТЗ 6.3). Продажа списывает товар с полки и выдаёт чек; деньги идут
 * мимо платформы, и об этом сказано на экране, а не умолчано.
 */
export default async function CompanySalesPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetSales");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  const rights = saleRightsFor({
    suspendedAt: company.suspendedAt,
    deletedAt: company.deletedAt,
    permissions: permissions as Record<string, string | undefined>,
  });
  if (!rights.see) notFound();

  const [rows, shelves, items] = await Promise.all([
    readSales(company.id, { scope: pointScope }),
    readWarehouses(company.id, pointScope),
    rights.sell ? readTillProducts(company.id, null) : Promise.resolve([]),
  ]);
  const openShelves = shelves.filter((w) => w.kind === "SHELF" && !w.archivedAt);
  const stock = rights.sell ? await readShelfStock(company.id, openShelves.map((w) => w.id)) : {};

  return (
    <main className="mx-auto w-full max-w-[760px] overflow-x-clip px-4 py-8 md:px-6">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="mb-5 text-[12px] text-muted">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-5">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="mt-1 text-[13px] leading-snug text-muted">{t("subtitle")}</p>
      </header>

      {rights.sell ? (
        <TillForm
          companyId={company.id}
          locale={locale}
          shelves={openShelves.map((w) => ({ id: w.id, name: w.name, pointName: w.pointName }))}
          items={items.map((i) => ({
            productId: i.productId,
            name: i.name,
            unit: i.unit,
            currency: i.currency,
            listPrice: i.listPrice,
            cashbackPercent: i.cashbackPercent,
            service: i.stock === null,
          }))}
          stock={stock}
        />
      ) : (
        <p className="rounded-[12px] border border-hairline bg-card p-3 text-[12.5px] leading-snug text-muted">
          {t("readOnly")}
        </p>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-[12px] uppercase tracking-[0.2em] text-muted">{t("listHeading")}</h2>
        {rows.length === 0 ? (
          <p className="text-[13px] text-muted">{t("listEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/${locale}/cabinet/companies/${company.id}/sales/${r.id}`}
                  className="flex min-h-14 items-center gap-3 rounded-[12px] border border-hairline bg-card px-3 hover:border-accent"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {t("rowNumber", { number: r.number })}
                      {r.status === "CANCELLED" ? ` · ${t("cancelledMark")}` : ""}
                    </span>
                    <span className="block text-[11.5px] text-muted">
                      {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(r.createdAt)}
                      {" · "}
                      {t("rowLines", { count: r.lineCount })}
                      {r.pointName ? ` · ${r.pointName}` : ""}
                      {r.buyerClaimed ? ` · ${t("rowClaimed")}` : ""}
                    </span>
                  </div>
                  <span className="shrink-0 text-[13px] num">
                    {new Intl.NumberFormat(locale, { style: "currency", currency: r.currency }).format(r.total)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
