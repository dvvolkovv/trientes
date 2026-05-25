import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerExchangeById } from "@/lib/registered-exchange";
import { ExchangeProfileForm } from "@/components/business/exchange-profile-form";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-500",
  APPROVED: "bg-green-500/15 text-green-500",
  REJECTED: "bg-red-500/15 text-red-500",
};

export default async function ExchangeManagementPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinet.exchanges");
  const { userId, exchange } = await getViewerExchangeById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!exchange) notFound();

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[36px] font-bold tracking-[-0.03em]">{exchange.displayName}</h1>
        <span className={`text-xs px-3 py-1 rounded ${STATUS_CLASS[exchange.status] ?? ""}`}>
          {t(`status.${exchange.status}`)}
        </span>
      </header>
      {exchange.status === "REJECTED" && exchange.rejectionReason && (
        <p className="text-sm text-red-400">
          {t("rejectedReason")}: {exchange.rejectionReason}
        </p>
      )}
      <ExchangeProfileForm
        exchangeId={exchange.id}
        initial={{
          legalName: exchange.legalName,
          displayName: exchange.displayName,
          description: exchange.description ?? "",
          website: exchange.website,
          country: exchange.country,
          email: exchange.email,
          phone: exchange.phone ?? "",
          address: exchange.address ?? "",
          logoUrl: exchange.logoUrl ?? "",
        }}
      />
    </main>
  );
}
