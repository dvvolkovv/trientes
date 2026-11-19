import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { countOffersByCategory, readCompanyRates } from "@/lib/loyalty/read";
import { cashbackSummary } from "@/lib/loyalty/rates";
import { CashbackRatesForm } from "@/components/loyalty/rates-form";

export const dynamic = "force-dynamic";

/**
 * Ставки кэшбэка предприятия. Своей модерации у них нет — ставку объявляет уже
 * залистованное предприятие, тем же правом, которым правит паспорт и цену.
 */
export default async function CompanyLoyaltyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetLoyalty");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "pricing")) notFound();
  const editable = canEditSection(permissions, "pricing");

  const [rates, counts] = await Promise.all([
    readCompanyRates(company.id),
    countOffersByCategory(company.id),
  ]);
  const summary = cashbackSummary({ base: rates.base, categories: Object.values(rates.byCategory) });
  const { base, max } = summary ?? { base: null, max: null };
  const listed = company.status === "APPROVED" && !company.suspendedAt;

  return (
    <main className="max-w-[900px] mx-auto px-4 md:px-12 py-10">
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
      ) : null}

      {/* Как это читается покупателем — одной строкой, теми же словами, что на витрине. */}
      <p className="text-sm border border-hairline rounded-md p-3 mb-6">
        {base !== null && max !== null
          ? t("previewBoth", { base, max })
          : base !== null
            ? t("previewBase", { base })
            : max !== null
              ? t("previewMax", { max })
              : t("previewEmpty")}
      </p>

      {editable ? (
        <CashbackRatesForm
          companyId={company.id}
          base={rates.base === null ? "" : String(rates.base)}
          byCategory={Object.fromEntries(
            Object.entries(rates.byCategory).map(([k, v]) => [k, String(v)]),
          )}
          offerCounts={counts}
        />
      ) : (
        <p className="text-sm text-muted">{t("readOnly")}</p>
      )}

      <p className="text-[11px] text-muted mt-8">{t("accrualNote")}</p>
    </main>
  );
}
