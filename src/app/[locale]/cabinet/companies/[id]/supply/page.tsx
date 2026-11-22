import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { readMovableProducts, readWarehouses } from "@/lib/warehouse/read";
import {
  readIncomingOrders,
  readOrders,
  readPortalCandidates,
  readReorderRules,
  readSuppliers,
  type OrderRow,
} from "@/lib/supply/read";
import { SupplierSection } from "@/components/supply/supplier-form";
import { OrderCreateForm } from "@/components/supply/order-create-form";
import { ReorderRules } from "@/components/supply/reorder-rules";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Поставки предприятия: заказы поставщикам, сами поставщики, правила автозаказа и —
 * если наше предприятие кому-то поставляет — «заказы нам». Это и есть портал
 * поставщика: своего входа у него нет, он смотрит в свой же кабинет.
 */
export default async function CompanySupplyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("supply");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "supply")) notFound();
  const editable = canEditSection(permissions, "supply") && !company.suspendedAt && !company.deletedAt;

  const [suppliers, orders, incoming, rules, warehouses, products, candidates] = await Promise.all([
    readSuppliers(company.id),
    readOrders(company.id, { scope: pointScope }),
    readIncomingOrders(company.id),
    readReorderRules(company.id, pointScope),
    readWarehouses(company.id, pointScope),
    readMovableProducts(company.id),
    editable ? readPortalCandidates(company.id) : Promise.resolve([]),
  ]);

  const liveWarehouses = warehouses.filter((w) => !w.archivedAt).map((w) => ({ id: w.id, name: w.name }));
  const activeSuppliers = suppliers.filter((s) => !s.archivedAt).map((s) => ({ id: s.id, name: s.name }));

  // Подпись срока зависит от стороны: «вы запросили» на портале поставщика было бы
  // ложью — просил покупатель (поймано живым прогоном BI).
  const row = (o: OrderRow, who: string, incoming = false) => (
    <li key={o.id} className="border border-hairline rounded-lg p-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {who}
          {o.autoDrafted ? <span className="text-muted"> · {t("autoDrafted")}</span> : null}
        </div>
        <div className="text-[11px] text-muted">
          {t(`status.${o.status}`)}
          {o.warehouseName ? ` · ${o.warehouseName}` : ""}
          {` · ${t("lineCount", { count: o.lineCount })}`}
        </div>
        {o.confirmedEta || o.expectedAt ? (
          <div className="text-[11px] text-muted num">
            {o.confirmedEta
              ? t("etaConfirmed", { date: o.confirmedEta.toISOString().slice(0, 10) })
              : t(incoming ? "etaAskedByBuyer" : "etaAsked", { date: o.expectedAt!.toISOString().slice(0, 10) })}
          </div>
        ) : null}
      </div>
      <Link
        href={`/${locale}/cabinet/companies/${company.id}/supply/${o.id}`}
        className="h-12 px-4 rounded-md border border-hairline text-sm flex items-center shrink-0"
      >
        {t("open")}
      </Link>
    </li>
  );

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

      <section className="mb-10">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("ordersHeading")}</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted mb-3">{t("ordersEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2 mb-3">{orders.map((o) => row(o, o.supplierName))}</ul>
        )}
        {editable ? (
          <OrderCreateForm
            companyId={company.id}
            suppliers={activeSuppliers}
            warehouses={liveWarehouses}
            currency="USD"
          />
        ) : null}
      </section>

      {incoming.length > 0 ? (
        <section className="mb-10">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("incomingHeading")}</h2>
          <p className="text-sm text-muted mb-3">{t("incomingIntro")}</p>
          <ul className="flex flex-col gap-2">{incoming.map((o) => row(o, o.buyerName, true))}</ul>
        </section>
      ) : null}

      <SupplierSection
        companyId={company.id}
        editable={editable}
        candidates={candidates}
        rows={suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          contactName: s.contactName,
          email: s.email,
          phone: s.phone,
          note: s.note,
          archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
          portalCompanyId: s.portalCompanyId,
          portalCompanyName: s.portalCompanyName,
          openOrders: s.openOrders,
        }))}
      />

      <ReorderRules
        companyId={company.id}
        editable={editable}
        rows={rules}
        warehouses={liveWarehouses}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        suppliers={activeSuppliers}
      />
    </main>
  );
}
