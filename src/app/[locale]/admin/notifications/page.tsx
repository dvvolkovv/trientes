import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { AdminNav } from "@/components/admin/nav";
import { NotificationsReadMarker } from "@/components/admin/notifications-read-marker";
import { ADMIN_BUTTON_SECONDARY, ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.bell");
  const admin = await checkAdmin();
  if (!admin.ok) return null; // до сюда не доходит: гейт стоит в admin/layout.tsx

  const rows = await prisma.adminNotification.findMany({
    where: { userId: admin.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = rows.filter((r) => !r.readAt).length;

  const time = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      {unread > 0 ? <NotificationsReadMarker /> : null}
      <header className="mb-6 text-center">
        <h1 className="text-[26px] font-bold tracking-[-0.03em]">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle", { count: unread })}</p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-hairline bg-card p-8 text-center text-muted">
          {t("empty")}
        </div>
      ) : (
        <ul className="flex flex-col gap-3 pb-10">
          {rows.map((n) => (
            <li
              key={n.id}
              className={`rounded-[18px] border bg-card p-4 ${
                n.readAt ? "border-hairline" : "border-accent/45"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted">
                <span className="font-semibold">{t(`kinds.${n.kind}`)}</span>
                <span>{time.format(n.createdAt)}</span>
              </div>
              <div className="text-[14px] font-semibold leading-tight">{n.title}</div>
              {n.body ? <p className="mt-1 text-[12px] text-muted">{n.body}</p> : null}
              {n.caseId ? (
                <Link
                  href={`/${locale}/admin/cases/${n.caseId}`}
                  className={`${ADMIN_BUTTON_SECONDARY} mt-3`}
                >
                  {t("open")}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
