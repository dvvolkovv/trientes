import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { CoinActiveToggle } from "@/components/admin/coin-active-toggle";
import { AddCoinForm } from "@/components/admin/add-coin-form";

export const dynamic = "force-dynamic";

export default async function AdminCoinsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const coins = await prisma.coin.findMany({
    orderBy: [{ source: "asc" }, { rank: "asc" }],
    take: 250,
    select: {
      id: true,
      symbol: true,
      name: true,
      rank: true,
      source: true,
      isActive: true,
      logoUrl: true,
      metadataFetchedAt: true,
    },
  });

  return (
    <>
      <AdminNav locale={locale} active="coins" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">
          Admin
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("coins.title")}
        </h1>
        <p className="text-muted">{t("coins.subtitle")}</p>
      </header>

      <div className="mb-6">
        <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-3">
          {t("addCoin.heading")}
        </h2>
        <AddCoinForm />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-hairline rounded-[20px] overflow-hidden mt-8">
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                #
              </th>
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("coins.name")}
              </th>
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("coins.source")}
              </th>
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("coins.metadata")}
              </th>
              <th className="text-right text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("coins.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {coins.map((c, idx) => (
              <tr
                key={c.id}
                className={idx < coins.length - 1 ? "border-b border-hairline" : ""}
              >
                <td className="px-5 py-4 num text-[13px] text-muted">
                  {c.rank >= 9999 ? "—" : c.rank}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    {c.logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.logoUrl}
                        alt=""
                        width={20}
                        height={20}
                        className="rounded-full"
                      />
                    )}
                    <span className="font-medium text-[15px]">{c.name}</span>
                    <span className="num text-[11px] uppercase tracking-wider text-muted">
                      {c.symbol}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span
                    className={
                      c.source === "AUTO_L1"
                        ? "num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium bg-info/15 text-info"
                        : "num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium bg-accent/15 text-accent"
                    }
                  >
                    {c.source}
                  </span>
                </td>
                <td className="px-5 py-4 num text-[11px] text-muted">
                  {c.metadataFetchedAt
                    ? c.metadataFetchedAt.toISOString().slice(0, 10)
                    : "—"}
                </td>
                <td className="px-5 py-4 text-right">
                  <CoinActiveToggle coinId={c.id} initialActive={c.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2 mt-6">
        {coins.map((c) => (
          <div
            key={c.id}
            className="bg-card border border-hairline rounded-[16px] p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.logoUrl}
                  alt=""
                  width={24}
                  height={24}
                  className="rounded-full flex-shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-card-alt flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  {c.symbol[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-[14px]">{c.name}</span>
                  <span className="num text-[11px] uppercase tracking-wider text-muted">
                    {c.symbol}
                  </span>
                </div>
                <div className="num text-[11px] text-muted mt-0.5">
                  #{c.rank >= 9999 ? "—" : c.rank} ·{" "}
                  {c.metadataFetchedAt
                    ? c.metadataFetchedAt.toISOString().slice(0, 10)
                    : "no metadata"}
                </div>
              </div>
              <CoinActiveToggle coinId={c.id} initialActive={c.isActive} />
            </div>
            <span
              className={
                c.source === "AUTO_L1"
                  ? "num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium bg-info/15 text-info"
                  : "num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium bg-accent/15 text-accent"
              }
            >
              {c.source}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
