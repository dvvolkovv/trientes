import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PER_PAGE = 30;

type SearchParams = { q?: string; cc?: string; coin?: string; page?: string };

export default async function OnlineServicesDirectory({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("servicesDirectory");

  const q = (sp.q ?? "").trim();
  const cc = (sp.cc ?? "").trim().toUpperCase();
  const coin = (sp.coin ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(sp.page ?? "1"));

  const where: Prisma.CompanyPointWhereInput = {
    status: "APPROVED",
    type: "ONLINE",
    company: { status: "APPROVED", deletedAt: null },
    deletedAt: null,
  };
  if (q.length >= 2) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { company: { displayName: { contains: q, mode: "insensitive" } } },
    ];
  }
  // Сохраняем deletedAt: null из начального where — иначе фильтр по стране
  // незаметно открыл бы удалённые компании.
  if (/^[A-Z]{2}$/.test(cc)) where.company = { ...(where.company as object), countryCode: cc };
  if (coin) where.acceptedCoinIds = { has: coin };

  const [total, rows] = await Promise.all([
    prisma.companyPoint.count({ where }),
    prisma.companyPoint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true, name: true, description: true, website: true, acceptedCoinIds: true,
        company: {
          select: { id: true, displayName: true, logoUrl: true, country: true, countryCode: true, kybStatus: true },
        },
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
        <input name="q" defaultValue={q} placeholder={t("searchPlaceholder")}
          className="flex-1 min-w-[180px] bg-card border border-hairline rounded-md px-3 py-2 text-sm" />
        <input name="cc" defaultValue={cc} maxLength={2} placeholder={t("countryPlaceholder")}
          className="w-24 bg-card border border-hairline rounded-md px-3 py-2 text-sm uppercase tracking-wider" />
        <input name="coin" defaultValue={coin} placeholder={t("coinPlaceholder")}
          className="w-32 bg-card border border-hairline rounded-md px-3 py-2 text-sm lowercase" />
        <button type="submit" className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium">
          {t("search")}
        </button>
        {q || cc || coin ? (
          <Link href={`/${locale}/services`} className="px-4 py-2 rounded-md border border-hairline text-sm text-muted">
            {t("clear")}
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((r) => (
            <li key={r.id} className="bg-card border border-hairline rounded-[16px] p-4 hover:border-accent transition-colors">
              <div className="flex items-center gap-3 mb-2">
                {r.company.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.company.logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-bg-tint" />
                )}
                <div className="min-w-0 flex-1">
                  <Link href={`/${locale}/companies/${r.company.id}`} className="font-medium truncate flex items-center gap-2 hover:text-accent">
                    {r.name}
                    {r.company.kybStatus === "APPROVED" ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500">✓</span>
                    ) : null}
                  </Link>
                  <div className="text-xs text-muted truncate">{r.company.displayName}</div>
                </div>
              </div>
              {r.description ? (
                <p className="text-xs text-muted line-clamp-2 mb-2">{r.description}</p>
              ) : null}
              {r.acceptedCoinIds.length > 0 ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {r.acceptedCoinIds.slice(0, 6).map((c) => (
                    <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-md bg-bg-tint text-muted uppercase">{c}</span>
                  ))}
                  {r.acceptedCoinIds.length > 6 ? (
                    <span className="text-[10px] text-muted">+{r.acceptedCoinIds.length - 6}</span>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>{r.company.country ?? r.company.countryCode ?? ""}</span>
                {r.website ? (
                  <a href={r.website} target="_blank" rel="noopener noreferrer nofollow"
                    className="text-accent hover:underline">
                    {t("visit")} →
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-center gap-2 mt-10 text-sm">
          {page > 1 ? (
            <Link href={withParam(sp, "page", String(page - 1), locale)}
              className="px-3 py-1.5 rounded-md border border-hairline">←</Link>
          ) : null}
          <span className="text-muted">{t("pageOf", { page, pages })}</span>
          {page < pages ? (
            <Link href={withParam(sp, "page", String(page + 1), locale)}
              className="px-3 py-1.5 rounded-md border border-hairline">→</Link>
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
  return `/${locale}/services?${usp.toString()}`;
}
