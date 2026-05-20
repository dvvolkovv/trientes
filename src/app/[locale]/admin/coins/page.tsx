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
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("coins.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("coins.subtitle")}</p>
      </header>

      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">{t("addCoin.heading")}</h2>
        <AddCoinForm />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">{t("coins.name")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("coins.source")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("coins.metadata")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("coins.status")}</th>
            </tr>
          </thead>
          <tbody>
            {coins.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.rank >= 9999 ? "—" : c.rank}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {c.logoUrl && (
                      <img src={c.logoUrl} alt="" width={16} height={16} className="rounded-full" />
                    )}
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground uppercase">{c.symbol}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      c.source === "AUTO_L1"
                        ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                        : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                    }`}
                  >
                    {c.source}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {c.metadataFetchedAt ? c.metadataFetchedAt.toISOString().slice(0, 10) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <CoinActiveToggle coinId={c.id} initialActive={c.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
