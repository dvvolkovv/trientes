import Link from "next/link";
import { getTranslations } from "next-intl/server";

const TABS = [
  { key: "requests", path: "requests" },
  { key: "coins", path: "coins" },
  { key: "users", path: "users" },
];

export async function AdminNav({ locale, active }: { locale: string; active: string }) {
  const t = await getTranslations("admin");
  return (
    <nav className="border-b mb-6">
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/${locale}/admin/${tab.path}`}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              active === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`tabs.${tab.key}`)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
