import Link from "next/link";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { readCustomerThreads } from "@/lib/customer-messages/read";

/**
 * «Сообщения магазинам» в кабинете покупателя (слайс BQ). Раздела у человека без ни
 * одной нитки нет вовсе: пустой раздел рассказывает о возможности, которой человек не
 * просил, а дверь в переписку стоит там, где он её откроет — на карточке магазина.
 */
export async function StoreMessagesSection({ locale }: { locale: string }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return null;

  const [t, threads] = await Promise.all([
    getTranslations("customerMessages"),
    readCustomerThreads(userId),
  ]);
  if (threads.length === 0) return null;

  const unread = threads.reduce((sum, row) => sum + row.unread, 0);

  return (
    <section id="store-messages">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("myTitle")}</h2>
      <p className="text-sm text-muted mb-4">{t("mySubtitle")}</p>
      <Link
        href={`/${locale}/cabinet/messages`}
        className="flex h-12 w-full items-center justify-between rounded-[14px] border border-hairline bg-card px-4 text-sm"
      >
        <span>{t("myCount", { count: threads.length })}</span>
        {unread > 0 ? (
          <span className="rounded-full bg-accent/15 px-2 py-[2px] text-[11px] text-accent">🔔 {unread}</span>
        ) : null}
      </Link>
    </section>
  );
}
