import Link from "next/link";
import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { SUPPORTED_LOCALES } from "@/lib/locales";
import { PRODUCT_CATEGORIES } from "@/lib/products/categories";
import { readCatalog } from "@/lib/products/read";
import { ProductBarcodeSearch } from "@/components/product/barcode-search";

export const dynamic = "force-dynamic";

const SITE = "https://trientes.org";

type SearchParams = { q?: string; category?: string; page?: string };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "products" });
  return {
    // Абсолютный заголовок: корневой шаблон иначе дописал бы «· Trientes» второй раз.
    title: { absolute: `${t("title")} · Trientes` },
    description: t("subtitle"),
    alternates: {
      canonical: `${SITE}/${locale}/products`,
      languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `${SITE}/${l}/products`])),
    },
  };
}

export default async function ProductCatalog({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("products");

  const q = (sp.q ?? "").trim();
  const category = (sp.category ?? "").trim();
  const { rows, total, page, pages } = await readCatalog({ q, category, page: Number(sp.page ?? "1") });

  const query = (next: Record<string, string | number>) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (category) u.set("category", category);
    for (const [k, v] of Object.entries(next)) u.set(k, String(v));
    return `?${u.toString()}`;
  };

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-12 py-12">
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">{t("kicker")}</div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-[-0.03em] mb-2">{t("title")}</h1>
        <p className="text-muted">{t("subtitle")}</p>
      </header>

      <form action="" method="get" className="flex flex-wrap gap-2 mb-8">
        <input
          name="q"
          defaultValue={q}
          placeholder={t("searchPlaceholder")}
          className="flex-1 min-w-[200px] bg-card border border-hairline rounded-md px-3 py-2 text-sm"
        />
        <select
          name="category"
          defaultValue={category}
          className="bg-card border border-hairline rounded-md px-3 py-2 text-sm"
        >
          <option value="">{t("allCategories")}</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium">
          {t("search")}
        </button>
      </form>

      {/* Камерой — отдельно от формы поиска: снятый код ведёт прямо в паспорт, а не в
          список совпадений, и перезагружать страницу для этого незачем. */}
      <div className="mb-8">
        <ProductBarcodeSearch locale={locale} />
      </div>

      <p className="text-xs text-muted mb-4">{t("found", { count: total })}</p>

      {rows.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/${locale}/product/${r.slug}`}
              className="border border-hairline rounded-lg overflow-hidden bg-card hover:border-accent transition-colors"
            >
              <div className="aspect-square bg-hairline/30 flex items-center justify-center overflow-hidden">
                {r.photoUrl ? (
                  // Чужих хостов тут не бывает: адрес проверен при записи (isOwnMediaUrl).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photoUrl} alt={r.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <span className="text-3xl opacity-40">📦</span>
                )}
              </div>
              <div className="p-3">
                <div className="text-sm font-medium leading-tight mb-1">{r.name}</div>
                {r.brand ? <div className="text-xs text-muted">{r.brand}</div> : null}
                <div className="text-[11px] text-muted mt-2 flex items-center gap-2">
                  <span>{t(`category.${r.category}`)}</span>
                  {r.hasVideo ? <span title={t("hasVideo")}>🎬</span> : null}
                </div>
                {r.ownerName ? (
                  <div className="text-[11px] text-accent mt-1">{t("byManufacturer", { name: r.ownerName })}</div>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}

      {pages > 1 ? (
        <nav className="flex items-center gap-3 mt-8 text-sm">
          {page > 1 ? (
            <Link href={query({ page: page - 1 })} className="px-3 py-2 border border-hairline rounded-md">
              {t("prev")}
            </Link>
          ) : null}
          <span className="num text-muted">{t("pageOf", { page, pages })}</span>
          {page < pages ? (
            <Link href={query({ page: page + 1 })} className="px-3 py-2 border border-hairline rounded-md">
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
