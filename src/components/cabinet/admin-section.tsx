import Link from "next/link";
import { getTranslations } from "next-intl/server";

// The admin queues, same list and labels as the tab strip inside /admin.
const TABS = [
  { key: "requests", path: "requests" },
  { key: "coinCards", path: "coin-cards" },
  { key: "business", path: "business" },
  { key: "fintech", path: "fintech" },
  { key: "exchanges", path: "exchanges" },
  { key: "coins", path: "coins" },
  { key: "users", path: "users" },
  { key: "audit", path: "audit" },
  { key: "analytics", path: "analytics" },
];

/**
 * Entry point to the moderation panel from inside the cabinet. The navbar link
 * lives in the burger menu, which is easy to miss on a phone — an admin who
 * only ever opens /cabinet had no visible way in.
 */
export async function AdminSection({ locale }: { locale: string }) {
  const t = await getTranslations("cabinet.admin");
  const tabs = await getTranslations("admin.tabs");
  return (
    <section id="admin" className="space-y-6">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      <p className="text-muted">{t("subtitle")}</p>
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/${locale}/admin/${tab.path}`}
            className="border border-hairline rounded-md px-4 py-2 text-sm hover:bg-card-alt transition-colors"
          >
            {tabs(tab.key)}
          </Link>
        ))}
      </div>
      <Link
        href={`/${locale}/admin`}
        className="inline-block bg-accent text-black font-medium rounded-md px-5 py-2.5 text-sm hover:opacity-90 transition-opacity"
      >
        {t("open")}
      </Link>
    </section>
  );
}
