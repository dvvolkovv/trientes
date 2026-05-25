import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CreateExchangeForm } from "@/components/cabinet/create-exchange-form";

async function listViewerExchanges() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return [];
  return prisma.registeredExchange.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, legalName: true, status: true },
  });
}

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-500",
  APPROVED: "bg-green-500/15 text-green-500",
  REJECTED: "bg-red-500/15 text-red-500",
};

export async function ExchangesSection({ locale }: { locale: string }) {
  const exchanges = await listViewerExchanges();
  const t = await getTranslations("cabinet.exchanges");
  return (
    <section id="exchanges" className="space-y-6">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      {exchanges.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {exchanges.map((x) => (
            <li key={x.id} className="border border-hairline rounded-md p-4 hover:bg-card-alt">
              <Link
                href={`/${locale}/cabinet/exchanges/${x.id}`}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <div className="font-medium">{x.displayName}</div>
                  <div className="text-xs text-muted">{x.legalName}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[x.status]}`}>
                  {t(`status.${x.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateExchangeForm />
    </section>
  );
}
