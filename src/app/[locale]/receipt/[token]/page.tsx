import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { readSaleByTokenHash } from "@/lib/sales/read";
import { hashReceiptToken } from "@/lib/sales/token";
import { ReceiptView } from "@/components/sales/receipt-view";
import { ClaimReceipt } from "@/components/sales/claim-receipt";

export const dynamic = "force-dynamic";

/**
 * Копия чека покупателю. Страница-предъявитель: читает тот, у кого ссылка, — как
 * бумажный чек. Поэтому `noindex`: это не витрина, и в поиске ей делать нечего.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("receipt");
  const receipt = await readSaleByTokenHash(hashReceiptToken(token));
  if (!receipt) notFound();

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const mine = Boolean(userId && receipt.buyerUserId === userId);

  return (
    <main className="mx-auto w-full max-w-[520px] overflow-x-clip px-4 py-8 md:px-6">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{t("bearerHint")}</p>
      </header>

      <ReceiptView receipt={receipt} locale={locale} />

      {mine ? (
        <p className="mt-3 text-[12.5px] leading-snug text-muted">{t("alreadyMine")}</p>
      ) : receipt.buyerUserId ? (
        <p className="mt-3 text-[12.5px] leading-snug text-muted">{t("claimedByOther")}</p>
      ) : (
        <ClaimReceipt token={token} locale={locale} signedIn={Boolean(userId)} />
      )}
    </main>
  );
}
