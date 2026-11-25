import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { readBuyerSale } from "@/lib/sales/read";
import { ReceiptView } from "@/components/sales/receipt-view";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Свой чек покупателя. Ссылка-предъявитель ему больше не нужна: чек привязан к записи,
 * и право на него — само `buyerUserId`. Сохранить копию и не уметь её открыть было бы
 * обещанием без содержания.
 */
export default async function MyReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; saleId: string }>;
}) {
  const { locale, saleId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("receipt");
  const viewer = await requireCabinetUser(locale, "/cabinet/receipts");
  if (!viewer) redirect(`/${locale}/login`);

  const receipt = await readBuyerSale(viewer.id, saleId);
  if (!receipt) notFound();

  return (
    <main className="mx-auto w-full max-w-[520px] overflow-x-clip px-4 py-8 md:px-6">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="mb-5 text-[12px] text-muted">
        <Link href={`/${locale}/cabinet/receipts`} className="hover:text-foreground">
          {t("myTitle")}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("number", { number: receipt.number })}</span>
      </nav>

      <ReceiptView receipt={receipt} locale={locale} />
    </main>
  );
}
