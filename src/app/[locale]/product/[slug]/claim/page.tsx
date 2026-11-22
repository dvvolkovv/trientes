import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readProductBySlug } from "@/lib/products/read";
import { ClaimProductForm } from "@/components/product/claim-form";

export const dynamic = "force-dynamic";

/**
 * «Это наш товар» — заявка производителя на владение паспортом. Поля паспорта здесь не
 * переписываются: заявка говорит «он наш», а не «вот наши данные». Решение принимает
 * сотрудник в очереди `products`: доказательством бывает устав, домен, упаковка.
 */
export default async function ClaimProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("products");

  const product = await readProductBySlug(slug);
  if (!product || product.suspendedAt || product.mergedIntoId) notFound();

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const next = `/${locale}/product/${slug}/claim`;
  if (!userId) redirect(`/${locale}/login?next=${encodeURIComponent(next)}`);

  const [members, pending] = await Promise.all([
    prisma.companyMember.findMany({
      where: {
        userId,
        role: { in: ["OWNER", "EDITOR"] },
        company: { status: "APPROVED", deletedAt: null, suspendedAt: null },
      },
      select: { company: { select: { id: true, displayName: true } } },
      orderBy: { company: { displayName: "asc" } },
    }),
    prisma.productClaim.findFirst({ where: { productId: product.id, status: "PENDING" }, select: { id: true } }),
  ]);

  return (
    <main className="max-w-[640px] mx-auto px-4 md:px-12 py-12">
      <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-2">{t("claim.title")}</h1>
      <p className="text-muted mb-6">{t("claim.subtitle", { name: product.name })}</p>

      {product.ownerCompanyId ? (
        <p className="text-sm text-muted">{t("claim.alreadyOwned")}</p>
      ) : pending ? (
        <p className="text-sm text-muted">{t("claim.pending")}</p>
      ) : members.length === 0 ? (
        <div className="text-sm text-muted">
          <p className="mb-3">{t("claim.needCompany")}</p>
          <Link href={`/${locale}/cabinet/companies`} className="text-accent">
            {t("claim.toCabinet")}
          </Link>
        </div>
      ) : (
        <ClaimProductForm
          productId={product.id}
          locale={locale}
          companies={members.map((m) => ({ id: m.company.id, name: m.company.displayName }))}
        />
      )}

      <p className="mt-8 text-xs text-muted">
        <Link href={`/${locale}/product/${slug}`} className="text-accent">
          {t("claim.back")}
        </Link>
      </p>
    </main>
  );
}
