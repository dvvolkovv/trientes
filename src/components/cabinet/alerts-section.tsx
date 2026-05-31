import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { CreateAlertForm } from "@/components/cabinet/create-alert-form";
import { AlertRow } from "@/components/cabinet/alert-row";
import { NotifyChannelsForm } from "@/components/cabinet/notify-channels-form";

type Props = {
  userId: string;
  notifyTelegram: boolean;
  notifyEmail: boolean;
  hasEmail: boolean;
  hasTelegramLinked: boolean;
  locale: string;
};

export async function AlertsSection({
  userId,
  notifyTelegram,
  notifyEmail,
  hasEmail,
  hasTelegramLinked,
  locale,
}: Props) {
  const t = await getTranslations("cabinet.alerts");
  const [alerts, coins] = await Promise.all([
    prisma.priceAlert.findMany({
      where: { userId },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, coinId: true, symbol: true, op: true, threshold: true,
        enabled: true, triggered: true, lastFiredAt: true,
      },
    }),
    prisma.coin.findMany({
      where: { isActive: true },
      orderBy: [{ rank: "asc" }, { symbol: "asc" }],
      take: 250,
      select: { id: true, symbol: true, name: true, logoUrl: true },
    }),
  ]);

  return (
    <section id="alerts" className="scroll-mt-24 space-y-6">
      <div>
        <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>

      <NotifyChannelsForm
        notifyTelegram={notifyTelegram}
        notifyEmail={notifyEmail}
        hasEmail={hasEmail}
        hasTelegramLinked={hasTelegramLinked}
      />

      <CreateAlertForm coins={coins} />

      {alerts.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id}>
              <AlertRow
                id={a.id}
                coinId={a.coinId}
                symbol={a.symbol}
                op={a.op}
                threshold={a.threshold}
                enabled={a.enabled}
                triggered={a.triggered}
                lastFiredAt={a.lastFiredAt ? a.lastFiredAt.toISOString() : null}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-muted">
        <Link href={`/${locale}/watchlist`} className="underline hover:text-foreground">
          {t("watchlistLink")}
        </Link>
      </p>
    </section>
  );
}
