import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";

const NEW_THRESHOLD_DAYS = 7;
const STALE_THRESHOLD_HOURS = 48;
const TOP_N = 5;

export async function ExchangeCardNewPairs({ exchangeId }: { exchangeId: string }) {
  const t = await getTranslations("exchangeCard");
  const newAfter = new Date(Date.now() - NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const staleBefore = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

  const [total, top] = await Promise.all([
    prisma.exchangeMarket.count({
      where: {
        exchangeId,
        firstSeenAt: { gte: newAfter },
        lastSeenAt: { gte: staleBefore },
      },
    }),
    prisma.exchangeMarket.findMany({
      where: {
        exchangeId,
        firstSeenAt: { gte: newAfter },
        lastSeenAt: { gte: staleBefore },
      },
      orderBy: { firstSeenAt: "desc" },
      take: TOP_N,
    }),
  ]);

  if (total === 0) return null;

  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("newPairs.title")}</h2>
      <div className="bg-card border border-hairline rounded-[16px] p-4">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="num text-[22px] font-semibold text-accent">+{total}</span>
          <span className="text-[12px] text-muted">{t("newPairs.subtitle", { days: NEW_THRESHOLD_DAYS })}</span>
        </div>
        <ul className="flex flex-wrap gap-2">
          {top.map((m) => (
            <li
              key={m.id}
              className="text-[12px] px-2.5 py-1 rounded-md border border-hairline bg-hairline/30 font-medium"
            >
              {m.pair}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
