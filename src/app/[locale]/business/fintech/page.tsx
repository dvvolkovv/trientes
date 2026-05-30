import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveOwnFintech } from "@/app/actions/fintech";
import { FintechForm } from "@/components/fintech/fintech-form";

export const dynamic = "force-dynamic";

export default async function BusinessFintech({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("fintech");

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login?next=/${locale}/business/fintech`);

  const existing = await prisma.fintechCompany.findUnique({ where: { ownerUserId: userId } });

  const initial = existing
    ? {
        slug: existing.slug,
        displayName: existing.displayName,
        legalName: existing.legalName ?? "",
        logoUrl: existing.logoUrl ?? "",
        website: existing.website,
        description: existing.description ?? "",
        countryCode: existing.countryCode ?? "",
        city: existing.city ?? "",
        address: existing.address ?? "",
        hqLat: existing.hqLat?.toString() ?? "",
        hqLon: existing.hqLon?.toString() ?? "",
        services: existing.services as string[],
        availableIn: existing.availableIn.join(", "),
        supportedCoinIds: existing.supportedCoinIds.join(", "),
        supportedFiats: existing.supportedFiats.join(", "),
        kycLevel: existing.kycLevel ?? "",
        feesSummary: existing.feesSummary ?? "",
        appStoreUrl: existing.appStoreUrl ?? "",
        playStoreUrl: existing.playStoreUrl ?? "",
        foundedYear: existing.foundedYear?.toString() ?? "",
      }
    : undefined;

  return (
    <main className="bg-bg">
      <div className="max-w-[1200px] mx-auto px-4 md:px-12 xl:px-20 py-12">
        <header className="mb-8">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">{t("business.eyebrow")}</div>
          <h1 className="text-[36px] md:text-[44px] font-bold tracking-[-0.03em]">{t("business.title")}</h1>
          <p className="text-muted mt-4 max-w-[640px]">{t("business.subtitle")}</p>
          {existing ? (
            <div className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-hairline text-sm">
              <span className="num text-[11px] uppercase tracking-wider text-muted">{t("business.status")}</span>
              <span className={
                existing.status === "APPROVED" ? "text-up" :
                existing.status === "REJECTED" ? "text-red-400" : "text-amber-400"
              }>
                {t(`business.statuses.${existing.status}`)}
              </span>
              {existing.status === "REJECTED" && existing.rejectionReason ? (
                <span className="text-muted text-xs">— {existing.rejectionReason}</span>
              ) : null}
            </div>
          ) : null}
        </header>
        <FintechForm initial={initial} submit={async (payload) => await saveOwnFintech(payload)} />
      </div>
    </main>
  );
}
