import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PER_PAGE = 30;

type SearchParams = { q?: string; cc?: string; page?: string };

export default async function CompaniesDirectory({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("companiesDirectory");

  const q = (sp.q ?? "").trim();
  const cc = (sp.cc ?? "").trim().toUpperCase();
  const page = Math.max(1, Number(sp.page ?? "1"));

  const where: Prisma.CompanyWhereInput = { status: "APPROVED" };
  if (q.length >= 2) {
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { legalName: { contains: q, mode: "insensitive" } },
    ];
  }
  if (/^[A-Z]{2}$/.test(cc)) where.countryCode = cc;

  // KYB-APPROVED rows surface first; everything else by recency.
  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: [{ kybStatus: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true, displayName: true, legalName: true, logoUrl: true,
        country: true, countryCode: true, city: true, kybStatus: true,
      },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-12 py-12">
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">{t("kicker")}</div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-[-0.03em] mb-2">{t("title")}</h1>
        <p className="text-muted">{t("subtitle")}</p>
      </header>

      <form action="" method="get" className="flex flex-wrap gap-2 mb-8">
        <input
          name="q"
          defaultValue={q}
          placeholder={t("searchPlaceholder")}
          className="flex-1 min-w-[180px] bg-card border border-hairline rounded-md px-3 py-2 text-sm"
        />
        <input
          name="cc"
          defaultValue={cc}
          maxLength={2}
          placeholder={t("countryPlaceholder")}
          className="w-24 bg-card border border-hairline rounded-md px-3 py-2 text-sm uppercase tracking-wider"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium"
        >
          {t("search")}
        </button>
        {q || cc ? (
          <Link href={`/${locale}/companies`} className="px-4 py-2 rounded-md border border-hairline text-sm text-muted">
            {t("clear")}
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/${locale}/companies/${c.id}`}
                className="block bg-card border border-hairline rounded-[16px] p-4 hover:border-accent transition-colors"
              >
                <div className="flex items-center gap-3 mb-2">
                  {c.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-bg-tint" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-2">
                      {c.displayName}
                      {c.kybStatus === "APPROVED" ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500">✓</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted truncate">{c.legalName}</div>
                  </div>
                </div>
                {c.country || c.countryCode || c.city ? (
                  <div className="text-[11px] text-muted">
                    {[c.city, c.country || c.countryCode].filter(Boolean).join(", ")}
                  </div>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-center gap-2 mt-10 text-sm">
          {page > 1 ? (
            <Link
              href={withParam(sp, "page", String(page - 1), locale)}
              className="px-3 py-1.5 rounded-md border border-hairline"
            >
              ←
            </Link>
          ) : null}
          <span className="text-muted">{t("pageOf", { page, pages })}</span>
          {page < pages ? (
            <Link
              href={withParam(sp, "page", String(page + 1), locale)}
              className="px-3 py-1.5 rounded-md border border-hairline"
            >
              →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}

function withParam(current: SearchParams, key: string, value: string, locale: string): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v) usp.set(k, String(v));
  usp.set(key, value);
  return `/${locale}/companies?${usp.toString()}`;
}
