import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveOwnFintech } from "@/app/actions/fintech";
import { FintechForm } from "@/components/fintech/fintech-form";

export const dynamic = "force-dynamic";

export default async function BusinessFintech({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { locale } = await params;
  const { id: editId } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("fintech");

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login?next=/${locale}/business/fintech`);

  // Сервисов у аккаунта может быть несколько: без ?id — форма создания и
  // список своих, с ?id — правка конкретного (только своего).
  const mine = await prisma.fintechCompany.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
  });
  const existing = editId ? mine.find((f) => f.id === editId) : undefined;
  if (editId && !existing) redirect(`/${locale}/business/fintech`);

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
        {mine.length > 0 ? (
          <section className="mb-10">
            <h2 className="text-[20px] font-bold tracking-[-0.02em] mb-3">{t("business.mine")}</h2>
            <ul className="space-y-2">
              {mine.map((f) => (
                <li
                  key={f.id}
                  className="border border-hairline rounded-md p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{f.displayName}</div>
                    <div className="text-xs text-muted truncate">/{f.slug}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={
                        f.status === "APPROVED" ? "text-up text-xs"
                        : f.status === "REJECTED" ? "text-red-400 text-xs"
                        : "text-amber-400 text-xs"
                      }
                    >
                      {t(`business.statuses.${f.status}`)}
                    </span>
                    <a
                      href={`/${locale}/business/fintech?id=${f.id}`}
                      className="text-[12px] px-2 py-1 rounded-md border border-hairline text-muted hover:border-accent hover:text-accent"
                    >
                      {t("business.edit")}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
            {!editId ? (
              <p className="text-[12px] text-muted mt-3">{t("business.addAnotherHint")}</p>
            ) : (
              <p className="text-[12px] text-muted mt-3">
                <a href={`/${locale}/business/fintech`} className="underline">
                  {t("business.addAnother")}
                </a>
              </p>
            )}
          </section>
        ) : null}
        <FintechForm
          key={existing?.id ?? "new"}
          initial={initial}
          submit={async (payload) => await saveOwnFintech(payload, existing?.id)}
        />
      </div>
    </main>
  );
}
