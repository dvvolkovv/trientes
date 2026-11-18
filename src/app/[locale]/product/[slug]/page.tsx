import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { SUPPORTED_LOCALES } from "@/lib/locales";
import { readProductBySlug } from "@/lib/products/read";
import { tokenizationReadiness } from "@/lib/products/rules";
import { ProductGallery, type GalleryPhoto } from "@/components/product/gallery";
import { SpeakButton } from "@/components/product/speak-button";
import { ProductReportDialog } from "@/components/product/report-dialog";

export const dynamic = "force-dynamic";

const SITE = "https://trientes.org";

type Params = { locale: string; slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await readProductBySlug(slug);
  if (!product) return {};
  const title = product.brand ? `${product.name} — ${product.brand}` : product.name;
  return {
    title: { absolute: `${title} · Trientes` },
    description: product.description.slice(0, 200),
    alternates: {
      canonical: `${SITE}/${locale}/product/${slug}`,
      languages: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `${SITE}/${l}/product/${slug}`])),
    },
  };
}

function photosOf(raw: unknown): GalleryPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: GalleryPhoto[] = [];
  for (const row of raw) {
    const r = (row ?? {}) as Record<string, unknown>;
    if (typeof r.url === "string" && r.url.startsWith("/uploads/products/")) {
      out.push({ url: r.url, label: typeof r.label === "string" ? r.label : undefined });
    }
  }
  return out;
}

function attributesOf(raw: unknown): { key: string; value: string; unit?: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((r) => r && typeof r.key === "string" && typeof r.value === "string")
    .map((r) => ({
      key: String(r.key),
      value: String(r.value),
      unit: typeof r.unit === "string" ? r.unit : undefined,
    }));
}

function documentsOf(raw: unknown): { kind: string; url: string; label?: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((r) => r && typeof r.url === "string" && String(r.url).startsWith("/uploads/products/"))
    .map((r) => ({
      kind: typeof r.kind === "string" ? r.kind : "other",
      url: String(r.url),
      label: typeof r.label === "string" ? r.label : undefined,
    }));
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("products");

  const product = await readProductBySlug(slug);
  if (!product) notFound();
  // Дубль ведёт на главный паспорт: две страницы одного товара разошлись бы содержимым.
  if (product.mergedIntoId && product.mergedInto) permanentRedirect(`/${locale}/product/${product.mergedInto.slug}`);
  // Снятый надзором паспорт в каталоге не показывается вовсе.
  if (product.suspendedAt) notFound();

  const photos = photosOf(product.photos);
  const attributes = attributesOf(product.attributes);
  const documents = documentsOf(product.documents);

  const readiness = tokenizationReadiness({
    name: product.name,
    category: product.category,
    description: product.description,
    photoCount: photos.length,
    documentCount: documents.length,
    gtin: product.gtin,
    ownerCompanyId: product.ownerCompanyId,
  });

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-12 py-10">
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/products`} className="hover:text-foreground">
          {t("title")}
        </Link>
        <span className="mx-2">/</span>
        <span>{t(`category.${product.category}`)}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-8">
        <ProductGallery photos={photos} videoUrl={product.videoUrl} name={product.name} closeLabel={t("close")} />

        <div>
          <h1 className="text-[28px] md:text-[34px] font-bold tracking-[-0.02em] leading-tight mb-2">{product.name}</h1>
          {product.brand ? <p className="text-muted mb-1">{product.brand}</p> : null}

          {product.owner ? (
            <Link href={`/${locale}/companies/${product.owner.id}`} className="inline-flex items-center gap-2 text-sm text-accent mb-4">
              {product.owner.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.owner.logoUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
              ) : null}
              {t("byManufacturer", { name: product.owner.displayName })}
            </Link>
          ) : product.manufacturerName ? (
            <p className="text-sm text-muted mb-4">{t("manufacturerStated", { name: product.manufacturerName })}</p>
          ) : (
            <p className="text-sm text-muted mb-4">{t("noManufacturer")}</p>
          )}

          {product.gtin ? (
            <p className="num text-sm mb-4">
              <span className="text-muted">{t("gtin")}: </span>
              {product.gtin}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 mb-6">
            <SpeakButton
              text={`${product.name}. ${product.description}${product.usage ? `. ${product.usage}` : ""}`}
              lang={product.language}
              label={t("listen")}
              stopLabel={t("listenStop")}
            />
            {!product.ownerCompanyId ? (
              <Link
                href={`/${locale}/product/${product.slug}/claim`}
                className="h-12 px-4 rounded-md border border-hairline text-sm font-medium flex items-center hover:border-accent"
              >
                {t("claimButton")}
              </Link>
            ) : null}
          </div>

          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t("descriptionHeading")}</h2>
            <p className="whitespace-pre-line leading-relaxed">{product.description}</p>
          </section>

          {product.usage ? (
            <section className="mb-6">
              <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t("usageHeading")}</h2>
              <p className="whitespace-pre-line leading-relaxed">{product.usage}</p>
            </section>
          ) : null}

          {product.ingredients ? (
            <section className="mb-6">
              <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t("ingredientsHeading")}</h2>
              <p className="whitespace-pre-line leading-relaxed">{product.ingredients}</p>
            </section>
          ) : null}
        </div>
      </div>

      {attributes.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("attributesHeading")}</h2>
          <table className="w-full text-sm border border-hairline rounded-lg overflow-hidden">
            <tbody>
              {attributes.map((a) => (
                <tr key={a.key} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2 text-muted w-1/3">{a.key}</td>
                  <td className="px-3 py-2 num">{a.unit ? `${a.value} ${a.unit}` : a.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {documents.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("documentsHeading")}</h2>
          <ul className="flex flex-col gap-2">
            {documents.map((d) => (
              <li key={d.url}>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent">
                  {d.label ?? t(`documentKind.${d.kind}`)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10 border border-hairline rounded-lg p-4">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t("tokenHeading")}</h2>
        {product.tokenChain && product.tokenAsset ? (
          <p className="text-sm">
            {t("tokenIssued", { chain: product.tokenChain, asset: product.tokenAsset })}
          </p>
        ) : readiness.ready ? (
          <p className="text-sm text-accent">{t("tokenReady")}</p>
        ) : (
          <div className="text-sm">
            <p className="text-muted mb-2">{t("tokenNotReady")}</p>
            <ul className="list-disc list-inside text-muted">
              {readiness.missing.map((m) => (
                <li key={m}>{t(`tokenMissing.${m}`)}</li>
              ))}
            </ul>
          </div>
        )}
        {/* Токен выпускает сеть, а не сайт: право собственности — это деньги. */}
        <p className="text-[11px] text-muted mt-3">{t("tokenNote")}</p>
      </section>

      <section className="mt-10">
        <ProductReportDialog
          productId={product.id}
          labels={{
            open: t("report.open"),
            title: t("report.title"),
            reason: {
              WRONG_DATA: t("report.reason.WRONG_DATA"),
              FAKE: t("report.reason.FAKE"),
              NOT_MINE: t("report.reason.NOT_MINE"),
              ILLEGAL: t("report.reason.ILLEGAL"),
              OTHER: t("report.reason.OTHER"),
            },
            commentLabel: t("report.comment"),
            send: t("report.send"),
            cancel: t("report.cancel"),
            sent: t("report.sent"),
            failed: t("report.failed"),
            errors: {
              comment_required: t("report.errors.comment_required"),
              too_soon: t("report.errors.too_soon"),
              not_found: t("report.errors.not_found"),
              captcha_required: t("report.errors.captcha"),
              captcha_invalid: t("report.errors.captcha"),
              captcha_too_fast: t("report.errors.captcha"),
            },
          }}
        />
      </section>
    </main>
  );
}
