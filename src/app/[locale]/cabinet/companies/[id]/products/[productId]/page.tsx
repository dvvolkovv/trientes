import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { editKind } from "@/lib/products/rules";
import { readProductHistory, readPendingRevisions } from "@/lib/products/read";
import { ProductForm, EMPTY_PRODUCT, type ProductFormValues } from "@/components/product/product-form";
import { ProductHistory } from "@/components/product/history";
import { RevisionsInbox } from "@/components/product/revisions-inbox";

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
  const { userId, company, role } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const creating = productId === "new";
  const product = creating ? null : await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!creating && !product) notFound();

  const gate = editKind(
    product ?? { ownerCompanyId: null, suspendedAt: null, mergedIntoId: null, deletedAt: null },
    {
      id: company.id,
      status: company.status,
      suspendedAt: company.suspendedAt,
      deletedAt: company.deletedAt,
      role: role ?? "VIEWER",
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
    : EMPTY_PRODUCT(locale);

  const [history, revisions] = product
    ? await Promise.all([readProductHistory(product.id), readPendingRevisions(product.id)])
    : [[], []];

  const owned = product?.ownerCompanyId === company.id;

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
