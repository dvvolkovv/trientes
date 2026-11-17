import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";

/**
 * Колокольчик живёт в полосе закладок админки — там, где он виден на любом
 * экране. Раскрывающегося списка нет: нажатие ведёт на страницу уведомлений,
 * и это одинаково работает пальцем и мышью.
 */
export async function AdminBell({ locale }: { locale: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return null;
  const t = await getTranslations("admin.bell");
  const count = await prisma.adminNotification.count({
    where: { userId: admin.userId, readAt: null },
  });

  return (
    <Link
      href={`/${locale}/admin/notifications`}
      title={t("title")}
      className="ml-auto flex h-11 shrink-0 items-center gap-1.5 self-center rounded-full border border-hairline px-3 text-[13px] font-semibold transition-colors hover:border-accent/60"
    >
      🔔
      {count > 0 ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-foreground">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
