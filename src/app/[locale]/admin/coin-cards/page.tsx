import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { CoinCardRow } from "@/components/admin/coin-card-row";

export const dynamic = "force-dynamic";

export default async function AdminCoinCardsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.coinCards");

  // The ADMIN gate lives in admin/layout.tsx — no second check needed here.
  const cards = await prisma.coinCard.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      contracts: true,
      markets: { take: 20 },
      steward: { select: { username: true, name: true, email: true } },
    },
  });

  return (
    <div>
      <AdminNav locale={locale} active="coinCards" />
      <h1 className="text-2xl font-semibold mb-1">{t("title")}</h1>
      <p className="text-muted text-sm mb-6">{t("subtitle")}</p>
      {cards.length === 0 ? (
        <p className="text-muted text-sm">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {cards.map((c) => (
            <CoinCardRow key={c.id} card={JSON.parse(JSON.stringify(c))} />
          ))}
        </div>
      )}
    </div>
  );
}
