import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canSeeSection, canEditSection } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { editKind } from "@/lib/products/rules";
import { readProductHistory, readPendingRevisions } from "@/lib/products/read";
import { ProductForm } from "@/components/product/product-form";
import { emptyProduct, type ProductFormValues } from "@/lib/products/form-values";
import { ProductHistory } from "@/components/product/history";
import { RevisionsInbox } from "@/components/product/revisions-inbox";
import { OfferForm } from "@/components/offers/offer-form";
import { readOfferForCabinet } from "@/lib/products/offers-read";
import { readStockByProduct } from "@/lib/warehouse/read";
import { readCompanyRates } from "@/lib/loyalty/read";
import { effectiveCashback } from "@/lib/loyalty/rates";
import { productLadder, ladderProgress } from "@/lib/products/ladder";
import { ProductLadder } from "@/components/cabinet/product-ladder";

export const dynamic = "force-dynamic";

/**
 * Заведение (`productId = "new"`) и правка паспорта из кабинета. Одна страница на оба
 * случая: форма одна, и две страницы разошлись бы полями.
 */
export default async function CompanyProductEditor({
  params,
}: {
  params: Promise<{ locale: string; id: string; productId: string }>;
}) {
  const { locale, id, productId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetProducts");
  const { userId, company, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const creating = productId === "new";
  const product = creating ? null : await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!creating && !product) notFound();

  if (!canSeeSection(permissions, "products")) notFound();
  const gate = editKind(
    product ?? { ownerCompanyId: null, suspendedAt: null, mergedIntoId: null, deletedAt: null },
    {
      id: company.id,
      status: company.status,
      suspendedAt: company.suspendedAt,
      deletedAt: company.deletedAt,
      permissions,
    },
  );

  const initial: ProductFormValues = product
    ? {
        id: product.id,
        name: product.name,
        brand: product.brand ?? "",
        manufacturerName: product.manufacturerName ?? "",
        category: product.category,
        language: product.language,
        gtin: product.gtin ?? "",
        description: product.description,
        usage: product.usage ?? "",
        ingredients: product.ingredients ?? "",
        attributes: Array.isArray(product.attributes) ? (product.attributes as ProductFormValues["attributes"]) : [],
        photos: Array.isArray(product.photos) ? (product.photos as ProductFormValues["photos"]) : [],
        videoUrl: product.videoUrl,
        documents: Array.isArray(product.documents) ? (product.documents as ProductFormValues["documents"]) : [],
      }
    : emptyProduct(locale);

  const [history, revisions, offer, stock, rates] = product
    ? await Promise.all([
        readProductHistory(product.id),
        readPendingRevisions(product.id),
        readOfferForCabinet(company.id, product.id),
        readStockByProduct(company.id, product.id),
        readCompanyRates(company.id),
      ])
    : [[], [], null, null, null];

  // Какая ставка действует на самом деле: продавец вписал пусто, а сверху могла стоять
  // ставка категории или «на всё» — не сказать об этом значит дать ему удивиться на
  // странице покупателя.
  const effective =
    product && rates
      ? effectiveCashback({
          offer: offer?.cashbackPercent ?? null,
          category: rates.byCategory[product.category] ?? null,
          company: rates.base,
        })
      : null;

  const owned = product?.ownerCompanyId === company.id;

  // Лестница настройки (слайс BM): две дешёвые выборки сверх уже прочитанного —
  // живые акции с этим товаром и правила автозаказа по нему.
  const [promoCount, reorderRules] = product
    ? await Promise.all([
        prisma.merchantPromo.count({
          where: { companyId: company.id, productId: product.id, archivedAt: null },
        }),
        prisma.reorderRule.count({ where: { companyId: company.id, productId: product.id } }),
      ])
    : [0, 0];
  const ladder = product
    ? productLadder({
        passport: {
          name: product.name,
          category: product.category,
          description: product.description ?? "",
          photoCount: Array.isArray(product.photos) ? product.photos.length : 0,
          gtin: product.gtin,
        },
        offer: offer ? { price: Number(offer.price), unit: offer.unit, active: offer.status === "ACTIVE" } : null,
        stockQty: stock?.byWarehouse.reduce((sum, row) => sum + row.qty, 0) ?? 0,
        cashbackPercent: effective ? effective.percent : null,
        promoCount,
        reorderRules,
      })
    : null;
  const companyBase = `/${locale}/cabinet/companies/${company.id}`;

  return (
    <main className="max-w-[900px] mx-auto px-4 md:px-12 py-10">
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/cabinet/companies/${company.id}/products`} className="hover:text-foreground">
          {t("title")}
        </Link>
        <span className="mx-2">/</span>
        <span>{creating ? t("create") : product!.name}</span>
      </nav>

      {gate === "forbidden" ? (
        <p className="text-sm text-muted border border-hairline rounded-md p-3">{t(`error.forbidden`)}</p>
      ) : (
        <ProductForm
          companyId={company.id}
          locale={locale}
          initial={initial}
          mode={creating ? "create" : "edit"}
          willPropose={gate === "revision"}
        />
      )}

      {ladder ? (
        <div className="mt-8">
          <ProductLadder
            steps={ladder}
            done={ladderProgress(ladder).done}
            total={ladderProgress(ladder).total}
            hrefs={{
              where: `${companyBase}/warehouses`,
              cashback: `${companyBase}/loyalty`,
              promo: `${companyBase}/promos`,
              supply: `${companyBase}/supply`,
            }}
          />
        </div>
      ) : null}

      {/* Предложение охраняется разделом «цена и кэшбэк», а не правом на паспорт:
          маркетолог правит цену, не правя свойств вещи, и наоборот (слайс BE). */}
      {product && canEditSection(permissions, "pricing") ? (
        <section className="mt-10 border border-hairline rounded-lg p-4">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("offerHeading")}</h2>
          {/* Цена и ставка — свойства продавца, а не паспорта: правятся там же, где товар. */}
          <OfferForm
            companyId={company.id}
            productId={product.id}
            initial={{
              price: offer ? String(offer.price) : "",
              currency: offer?.currency ?? "EUR",
              unit: offer?.unit ?? "pcs",
              cashbackPercent: offer?.cashbackPercent === null || offer === null ? "" : String(offer.cashbackPercent),
              saleRules: offer?.saleRules ?? "",
              onlineUrl: offer?.onlineUrl ?? "",
              status: offer?.status ?? "ACTIVE",
              exists: Boolean(offer),
            }}
          />

          {effective && effective.source !== "offer" ? (
            <p className="text-[11px] text-muted mt-2">
              {t(`effectiveFrom.${effective.source}`, { percent: effective.percent })}{" "}
              <Link
                href={`/${locale}/cabinet/companies/${company.id}/loyalty`}
                className="text-accent"
              >
                {t("loyaltyLink")}
              </Link>
            </p>
          ) : null}

          <div className="mt-4 pt-4 border-t border-hairline">
            <h3 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t("stockHeading")}</h3>
            {stock && stock.byWarehouse.length > 0 ? (
              <ul className="text-[13px] flex flex-col gap-1">
                {stock.byWarehouse.map((row) => (
                  <li key={row.warehouseId}>
                    <Link
                      href={`/${locale}/cabinet/companies/${company.id}/warehouses/${row.warehouseId}`}
                      className="hover:text-accent"
                    >
                      {row.name}
                    </Link>
                    <span className="num text-muted"> · {row.qty}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">{t("stockEmpty")}</p>
            )}
            {stock && stock.inTransit !== 0 ? (
              <p className="text-[13px] text-muted mt-1 num">{t("inTransit", { qty: stock.inTransit })}</p>
            ) : null}
            <Link
              href={`/${locale}/cabinet/companies/${company.id}/warehouses`}
              className="inline-flex items-center h-12 px-4 mt-3 rounded-md border border-hairline text-sm"
            >
              {t("toWarehouses")}
            </Link>
          </div>
        </section>
      ) : null}

      {product && owned && revisions.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("revisionsHeading")}</h2>
          <RevisionsInbox
            companyId={company.id}
            rows={revisions.map((r) => ({
              id: r.id,
              companyName: r.company?.displayName ?? "—",
              patch: Array.isArray(r.patch) ? (r.patch as { field: string; after: unknown }[]) : [],
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        </section>
      ) : null}

      {product && history.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("historyHeading")}</h2>
          <ProductHistory
            companyId={company.id}
            canRevert={gate === "direct"}
            rows={history.map((h) => ({
              id: h.id,
              field: h.field,
              author: h.company?.displayName ?? h.user?.username ?? h.user?.name ?? "—",
              createdAt: h.createdAt.toISOString(),
              isRevert: Boolean(h.revertOfId),
            }))}
          />
        </section>
      ) : null}
    </main>
  );
}
