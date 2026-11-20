import Link from "next/link";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { auth } from "@/auth";
import { ADMIN_COLUMN, ADMIN_TILE } from "@/lib/admin-ui";
import { readCustomerThreads } from "@/lib/customer-messages/read";

export const dynamic = "force-dynamic";

/** Переписка покупателя с магазинами (слайс BQ): по одному магазину одна нитка. */
export default async function CustomerMessagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("customerMessages");
  const format = await getFormatter();
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/cabinet/messages`)}`);

  const threads = await readCustomerThreads(userId);

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <div>
        <Link href={`/${locale}/cabinet`} className="text-[12px] text-muted underline">
          ← {t("backToCabinet")}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]">✉️ {t("myTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("mySubtitle")}</p>
      </div>

      {threads.length === 0 ? (
        <p className="rounded-[14px] border border-hairline bg-card p-4 text-sm text-muted">{t("myEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link href={`/${locale}/cabinet/messages/${thread.id}`} className={`${ADMIN_TILE} block`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{thread.title}</span>
                  <span className="text-[11px] text-muted">
                    {format.dateTime(thread.lastMessageAt, { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{thread.lastBody}</p>
                {thread.unread > 0 ? (
                  <span className="mt-2 inline-block rounded-full bg-accent/15 px-2 py-[2px] text-[11px] text-accent">
                    🔔 {thread.unread}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
