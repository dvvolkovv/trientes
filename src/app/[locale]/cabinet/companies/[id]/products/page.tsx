import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { readCompanyProducts } from "@/lib/products/read";
import { prisma } from "@/lib/prisma";
import { CabinetBackButton } from "@/components/cabinet/company-back";

export const dynamic = "force-dynamic";

/** Раздел «Товары» кабинета предприятия: паспорта, к которым оно прикасалось. */
export default async function CompanyProductsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetProducts");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "products")) notFound();
  const editable = canEditSection(permissions, "products");

  const [rows, incoming] = await Promise.all([
    readCompanyProducts(company.id),
    // Предложения правок к паспортам, которыми владеет это предприятие.
    prisma.productRevision.count({ where: { status: "PENDING", product: { ownerCompanyId: company.id } } }),
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
      ) : editable ? (
        <Link
          href={`/${locale}/cabinet/companies/${company.id}/products/new`}
          className="inline-flex items-center justify-center h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium mb-6"
        >
          {t("create")}
        </Link>
      ) : null}

      {incoming > 0 ? (
        <p className="text-sm text-accent mb-4">{t("incomingRevisions", { count: incoming })}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="border border-hairline rounded-lg p-3 flex items-center gap-3">
              <div className="w-12 h-12 rounded-md bg-hairline/30 overflow-hidden flex items-center justify-center shrink-0">
                {r.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="opacity-40">📦</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="text-[11px] text-muted">
                  {r.gtin ? <span className="num">{r.gtin} · </span> : null}
                  {t(`category.${r.category}`)}
                  {r.ownerCompanyId === company.id ? <span className="text-accent"> · {t("yours")}</span> : null}
                  {r.suspendedAt ? <span className="text-red-500"> · {t("suspended")}</span> : null}
                </div>
              </div>
              <Link
                href={`/${locale}/cabinet/companies/${company.id}/products/${r.id}`}
                className="h-12 px-4 rounded-md border border-hairline text-sm flex items-center shrink-0"
              >
                {editable ? t("edit") : t("open")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
