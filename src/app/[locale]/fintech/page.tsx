import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Prisma, FintechService, FintechKyc } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FintechCard } from "@/components/fintech/fintech-card";
import { FintechFilters } from "@/components/fintech/fintech-filters";

export const dynamic = "force-dynamic";

const PER_PAGE = 24;

type SearchParams = {
  service?: string;
  country?: string;
  coin?: string;
  fiat?: string;
  kyc?: string;
  sort?: string;
  page?: string;
};

export default async function FintechIndex({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("fintech");

  const where: Prisma.FintechCompanyWhereInput = { status: "APPROVED" };
  if (sp.service) where.services = { has: sp.service as FintechService };
  if (sp.country) where.availableIn = { has: sp.country.toUpperCase() };
  if (sp.coin) where.supportedCoinIds = { has: sp.coin.toLowerCase() };
  if (sp.fiat) where.supportedFiats = { has: sp.fiat.toUpperCase() };
  if (sp.kyc) where.kycLevel = sp.kyc as FintechKyc;

  const orderBy: Prisma.FintechCompanyOrderByWithRelationInput[] =
    sp.sort === "newest"
      ? [{ createdAt: "desc" }]
      : sp.sort === "featured"
      ? [{ source: "asc" }, { displayName: "asc" }]
      : [{ displayName: "asc" }];

  const page = Math.max(1, Number(sp.page ?? "1"));
  const [total, rows] = await Promise.all([
    prisma.fintechCompany.count({ where }),
    prisma.fintechCompany.findMany({
      where,
      orderBy,
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true, slug: true, displayName: true, logoUrl: true, description: true,
        services: true, countryCode: true,
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <main className="bg-bg">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-12">
        <header className="mb-10">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
            Section · VII
          </div>
          <h1 className="text-[40px] md:text-[56px] font-bold tracking-[-0.035em]">
            {t("title")}
          </h1>
          <p className="text-muted mt-4 text-[16px] md:text-[18px] leading-[1.5] max-w-[640px]">
            {t("subtitle")}
          </p>
        </header>

        <FintechFilters />

        {rows.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {rows.map((row) => (
                <FintechCard key={row.id} row={row} locale={locale} />
              ))}
            </div>

            {totalPages > 1 ? (
              <nav className="mt-10 flex justify-center gap-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                  const next = new URLSearchParams();
                  for (const [k, v] of Object.entries(sp)) if (v) next.set(k, v);
                  if (p === 1) next.delete("page");
                  else next.set("page", String(p));
                  const href = next.toString() ? `?${next.toString()}` : "?";
                  return (
                    <a key={p} href={href}
                      className={
                        p === page
                          ? "num px-3 py-1.5 rounded-md bg-foreground text-bg text-xs"
                          : "num px-3 py-1.5 rounded-md bg-card text-muted hover:text-foreground border border-hairline text-xs"
                      }>
                      {p}
                    </a>
                  );
                })}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
