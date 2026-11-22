import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { readMovableProducts } from "@/lib/warehouse/read";
import { readOrder } from "@/lib/supply/read";
import { orderTotal } from "@/lib/supply/rules";
import { OrderBoard } from "@/components/supply/order-board";
import { CabinetBackButton } from "@/components/cabinet/company-back";

export const dynamic = "force-dynamic";

/**
 * Один заказ, две стороны. Страница одна: покупатель и поставщик смотрят в один
 * документ, а кнопки у них разные (`side`). Черновик адресату не виден вовсе — это ещё
 * не обещание.
 */
export default async function SupplyOrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; orderId: string }>;
}) {
  const { locale, id, orderId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("supply");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "supply")) notFound();

  const order = await readOrder(orderId);
  if (!order) notFound();

  const isBuyer = order.buyerCompanyId === company.id;
  const isSupplier = order.supplierCompanyId === company.id && order.status !== "DRAFT";
  if (!isBuyer && !isSupplier) notFound();
  // Участок сужает **и документ**, а не только список: живой прогон BI поймал обратное —
  // сотрудник одной точки открывал по прямой ссылке заказ на склад, которого не видит.
  // Заказ без склада виден всем: сужать его нечем.
  if (isBuyer && order.warehouseId && !pointScopeAllows(pointScope, order.warehousePointId)) notFound();

  const manage = canEditSection(permissions, "supply") && !company.suspendedAt && !company.deletedAt;
  const products = isBuyer ? await readMovableProducts(order.buyerCompanyId) : [];
  const total = orderTotal(order.lines.map((l) => ({ qty: l.qty, price: l.price })));
  const d = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

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
        <Link href={`/${locale}/cabinet/companies/${company.id}/supply`} className="hover:text-foreground">
          {t("title")}
        </Link>
        <span className="mx-2">/</span>
        <span>{t(`status.${order.status}`)}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-1">
          {isBuyer ? order.supplierName : order.buyerName}
        </h1>
        <p className="text-muted text-sm">
          {isBuyer ? t("sideBuyer") : t("sideSupplier")} · {t(`status.${order.status}`)}
          {order.autoDrafted ? ` · ${t("autoDrafted")}` : ""}
        </p>
      </header>

      <dl className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-8">
        {order.warehouseName ? (
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("warehouse")}</dt>
            <dd>{order.warehouseName}</dd>
          </div>
        ) : null}
        {d(order.expectedAt) ? (
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("expectedAt")}</dt>
            <dd className="num">{d(order.expectedAt)}</dd>
          </div>
        ) : null}
        {d(order.confirmedEta) ? (
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("confirmedEta")}</dt>
            <dd className="num">{d(order.confirmedEta)}</dd>
          </div>
        ) : null}
        {total !== null ? (
          <div>
            <dt className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("total")}</dt>
            {/* Сумма считается на экране: цена в заказе справочная, платежа у нас нет. */}
            <dd className="num">
              {total.toFixed(2)} {order.currency}
            </dd>
          </div>
        ) : null}
        {order.note ? (
          <div className="md:col-span-2">
            <dt className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("note")}</dt>
            <dd className="whitespace-pre-wrap">{order.note}</dd>
          </div>
        ) : null}
        {order.declineReason ? (
          <div className="md:col-span-2">
            <dt className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("declineReason")}</dt>
            <dd>{order.declineReason}</dd>
          </div>
        ) : null}
        {order.cancelReason ? (
          <div className="md:col-span-2">
            <dt className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("cancelReason")}</dt>
            <dd>{order.cancelReason}</dd>
          </div>
        ) : null}
      </dl>

      <OrderBoard
        side={isBuyer ? "BUYER" : "SUPPLIER"}
        manage={manage}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        order={{
          id: order.id,
          status: order.status,
          currency: order.currency,
          hasWarehouse: Boolean(order.warehouseId),
          // Нет портала — ходы второй стороны делает сам покупатель, иначе заказ
          // внешнему поставщику замирал бы на «отправлено» навсегда (живой прогон BI).
          hasPortal: Boolean(order.supplierCompanyId),
          lines: order.lines.map((l) => ({
            id: l.id,
            productName: l.productName,
            productSlug: l.productSlug,
            qty: l.qty,
            receivedQty: l.receivedQty,
            price: l.price,
            unit: l.unit,
          })),
          docs: order.docs.map((doc) => ({ name: doc.name, filename: doc.filename, side: doc.side })),
        }}
      />
    </main>
  );
}
