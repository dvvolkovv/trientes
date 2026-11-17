import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminBell } from "./admin-bell";
import { loadViewerAccess } from "@/lib/authz/guard";
import { canAny, canOwnerOnly } from "@/lib/authz/policy";
import type { QueueKey } from "@/lib/cases/queues";

/**
 * Закладка рисуется, только если она доступна: сотруднику без прав на каталог
 * монет незачем видеть «Coins». Прямой переход всё равно проверяется на
 * сервере — скрытая ссылка не защита.
 */
const TABS: { key: string; path: string; queues?: QueueKey[]; owner?: boolean }[] = [
  { key: "queues", path: "queues" },
  { key: "staff", path: "staff", owner: true },
  { key: "requests", path: "requests", queues: ["coinRequests"] },
  { key: "coinCards", path: "coin-cards", queues: ["coinCards"] },
  { key: "business", path: "business", queues: ["companies", "points", "kyb"] },
  { key: "fintech", path: "fintech", queues: ["fintech"] },
  { key: "exchanges", path: "exchanges", queues: ["exchanges"] },
  { key: "coins", path: "coins", owner: true },
  { key: "users", path: "users", owner: true },
  { key: "audit", path: "audit", owner: true },
  { key: "analytics", path: "analytics", owner: true },
];

export async function AdminNav({ locale, active }: { locale: string; active: string }) {
  const t = await getTranslations("admin");
  const access = await loadViewerAccess();
  const now = new Date();
  const tabs = TABS.filter((tab) => {
    if (!access) return false;
    if (tab.owner) return canOwnerOnly(access);
    if (tab.queues) return canAny(access, tab.queues, "VIEW", now);
    return true;
  });
  return (
    <nav className="border-b border-hairline mb-6 md:mb-8 -mx-4 md:mx-0">
      <div className="flex overflow-x-auto px-4 md:px-0 scrollbar-thin">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/${locale}/admin/${tab.path}`}
            className={
              active === tab.key
                ? "border-b-2 border-accent text-foreground -mb-px px-4 md:px-5 py-3 text-sm font-medium uppercase tracking-wider transition-colors whitespace-nowrap"
                : "border-b-2 border-transparent text-muted hover:text-foreground px-4 md:px-5 py-3 text-sm font-medium uppercase tracking-wider transition-colors whitespace-nowrap"
            }
          >
            {t(`tabs.${tab.key}`)}
          </Link>
        ))}
        <AdminBell locale={locale} />
      </div>
    </nav>
  );
}
