import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { ADMIN_COLUMN, ADMIN_TILE } from "@/lib/admin-ui";
import { can } from "@/lib/company-team/permissions";
import { readStoreThreads } from "@/lib/customer-messages/read";

export const dynamic = "force-dynamic";

/**
 * Лента сообщений покупателей (слайс BQ, ТЗ 6.6). Раздел охраняется девятым правом
 * `customers`: говорить от имени магазина вправе не каждый член команды (спека § 2.4).
 */
export default async function CompanyInboxPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("customerMessages");
  const format = await getFormatter();
  const { userId, company, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!can(permissions, "customers", "VIEW")) notFound();

  const threads = await readStoreThreads(company.id);
  const base = `/${locale}/cabinet/companies/${company.id}`;

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <div>
        <Link href={`${base}/g/showcase`} className="text-[12px] text-muted underline">
          ← {company.displayName}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]">✉️ {t("inboxTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("inboxSubtitle")}</p>
      </div>

      {threads.length === 0 ? (
        <p className="rounded-[14px] border border-hairline bg-card p-4 text-sm text-muted">{t("inboxEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link href={`${base}/inbox/${thread.id}`} className={`${ADMIN_TILE} block`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{thread.title}</span>
                  <span className="text-[11px] text-muted">
                    {format.dateTime(thread.lastMessageAt, { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{thread.lastBody}</p>
                <div className="mt-2 flex gap-2">
                  {thread.unread > 0 ? (
                    <span className="rounded-full bg-accent/15 px-2 py-[2px] text-[11px] text-accent">
                      🔔 {thread.unread}
                    </span>
                  ) : null}
                  {thread.blocked ? (
                    <span className="rounded-full bg-down/15 px-2 py-[2px] text-[11px] text-down">
                      {t("blockedBadge")}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
