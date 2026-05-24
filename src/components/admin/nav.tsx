import Link from "next/link";
import { getTranslations } from "next-intl/server";

const TABS = [
  { key: "requests", path: "requests" },
  { key: "business", path: "business" },
  { key: "coins", path: "coins" },
  { key: "users", path: "users" },
  { key: "audit", path: "audit" },
];

export async function AdminNav({ locale, active }: { locale: string; active: string }) {
  const t = await getTranslations("admin");
  return (
    <nav className="border-b border-hairline mb-6 md:mb-8 -mx-4 md:mx-0">
      <div className="flex overflow-x-auto px-4 md:px-0 scrollbar-thin">
        {TABS.map((tab) => (
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
      </div>
    </nav>
  );
}
