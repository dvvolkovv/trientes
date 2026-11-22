import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import {
  readMovableProducts,
  readMovements,
  readWarehouse,
  readWarehouseStock,
  readWarehouses,
} from "@/lib/warehouse/read";
import { MovementForm } from "@/components/warehouse/movement-form";
import { ArchiveWarehouseButton } from "@/components/warehouse/archive-button";
import { CabinetBackButton } from "@/components/cabinet/company-back";

export const dynamic = "force-dynamic";

/** Один склад: остатки числами, форма движения и последние движения по нему. */
export default async function WarehousePage({
  params,
}: {
  params: Promise<{ locale: string; id: string; wid: string }>;
}) {
  const { locale, id, wid } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("warehouses");
  const format = await getFormatter();
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "warehouses")) notFound();
  const editable = canEditSection(permissions, "warehouses");

  const warehouse = await readWarehouse(company.id, wid, pointScope);
  if (!warehouse) notFound();

  const [stock, movements, all, products] = await Promise.all([
    readWarehouseStock(warehouse.id),
    readMovements(company.id, { warehouseId: warehouse.id, take: 30, scope: pointScope }),
    // Второй конец перемещения — только склады участка: отдать в список склад,
    // которого сотрудник не видит, значило бы предложить запрещённое движение.
    readWarehouses(company.id, pointScope),
    readMovableProducts(company.id),
  ]);

  return (
    <main className="max-w-[900px] mx-auto px-4 md:px-12 py-10">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/cabinet/companies/${company.id}/warehouses`} className="hover:text-foreground">
          {t("title")}
        </Link>
        <span className="mx-2">/</span>
        <span>{warehouse.name}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-1">{warehouse.name}</h1>
        <p className="text-muted text-sm">
          {t(`kinds.${warehouse.kind}`)}
          {warehouse.point ? ` · ${warehouse.point.name}` : warehouse.online ? ` · ${t("onlineShelf")}` : null}
          {warehouse.archivedAt ? ` · ${t("archived")}` : null}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("stockHeading")}</h2>
        {stock.length === 0 ? (
          <p className="text-sm text-muted">{t("stockEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stock.map((s) => (
              <li key={s.productId} className="border border-hairline rounded-lg p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-hairline/30 overflow-hidden flex items-center justify-center shrink-0">
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="opacity-40">📦</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/${locale}/product/${s.slug}`} className="text-sm font-medium truncate hover:text-accent">
                    {s.name}
                  </Link>
                  {s.brand ? <div className="text-[11px] text-muted truncate">{s.brand}</div> : null}
                </div>
                <div className="num text-sm shrink-0">{s.qty}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editable && !warehouse.archivedAt ? (
        <div className="mb-8">
          <MovementForm
            companyId={company.id}
            defaultWarehouseId={warehouse.id}
            warehouses={all.filter((w) => !w.archivedAt).map((w) => ({ id: w.id, name: w.name, kind: w.kind }))}
            products={products.map((p) => ({ id: p.id, name: p.name }))}
          />
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("movesHeading")}</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted">{t("movesEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {movements.map((m) => (
              <li key={m.id} className="border border-hairline rounded-md px-3 py-2">
                <span className="num">{format.dateTime(m.createdAt, { dateStyle: "short" })}</span>
                {" · "}
                {t(`moveKinds.${m.kind}`)}
                {" · "}
                <span className="num">{m.qty}</span>
                {" · "}
                {m.productName}
                {m.status !== "DONE" ? <span className="text-muted"> · {t(`moveStatus.${m.status}`)}</span> : null}
                {m.note ? <span className="text-muted"> · {m.note}</span> : null}
                {m.authorName ? <span className="text-muted"> · {m.authorName}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editable ? (
        <ArchiveWarehouseButton
          companyId={company.id}
          warehouseId={warehouse.id}
          archived={Boolean(warehouse.archivedAt)}
        />
      ) : null}
    </main>
  );
}
