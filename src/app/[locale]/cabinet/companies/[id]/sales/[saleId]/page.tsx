import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { readSale } from "@/lib/sales/read";
import { saleRightsFor } from "@/lib/sales/rules";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { ReceiptView } from "@/components/sales/receipt-view";
import { ReceiptActions } from "@/components/sales/receipt-actions";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/** Чек глазами продавца: тот же вид, что у покупателя, плюс кассир и два действия. */
export default async function CompanySalePage({
  params,
}: {
  params: Promise<{ locale: string; id: string; saleId: string }>;
}) {
  const { locale, id, saleId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetSales");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  const rights = saleRightsFor({
    suspendedAt: company.suspendedAt,
    deletedAt: company.deletedAt,
    permissions: permissions as Record<string, string | undefined>,
  });
  if (!rights.see) notFound();

  const receipt = await readSale(company.id, saleId);
  if (!receipt) notFound();
  // Участок сотрудника: чек чужой точки ему не виден вовсе (правило BE).
  if (!pointScopeAllows(pointScope, receipt.pointId)) notFound();

  return (
    <main className="mx-auto w-full max-w-[560px] overflow-x-clip px-4 py-8 md:px-6">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="mb-5 text-[12px] text-muted">
        <Link href={`/${locale}/cabinet/companies/${company.id}/sales`} className="hover:text-foreground">
          {t("title")}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("rowNumber", { number: receipt.number })}</span>
      </nav>

      <ReceiptView receipt={receipt} locale={locale} showCashier />

      {rights.sell ? (
        <ReceiptActions
          companyId={company.id}
          saleId={receipt.id}
          locale={locale}
          number={receipt.number}
          cancellable={receipt.status === "COMPLETED"}
          claimed={Boolean(receipt.buyerUserId)}
        />
      ) : null}
    </main>
  );
}
