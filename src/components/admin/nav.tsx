import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminBell } from "./admin-bell";
import { loadViewerAccess } from "@/lib/authz/guard";
import { canAny, canOwnerOnly } from "@/lib/authz/policy";
import { readViewerSectionColors } from "@/lib/admin-appearance";
import { sectionColorHex } from "@/lib/admin-sections";
import { ADMIN_TAB, ADMIN_TAB_STRIP } from "@/lib/admin-ui";
import { ADMIN_TABS } from "@/lib/admin-tabs";


export async function AdminNav({ locale, active }: { locale: string; active: string }) {
  const t = await getTranslations("admin");
  const access = await loadViewerAccess();
  const now = new Date();
  const colors = await readViewerSectionColors();
  const tabs = ADMIN_TABS.filter((tab) => {
    if (!access) return false;
    if (tab.owner) return canOwnerOnly(access);
    if (tab.queues) return canAny(access, tab.queues, "VIEW", now);
    return true;
  });
  return (
    <nav className="mb-6 md:mb-8 -mx-4 md:mx-0">
      <div className={ADMIN_TAB_STRIP}>
        {tabs.map((tab) => {
          const hex = sectionColorHex(colors, tab.key);
          const isActive = active === tab.key;
          return (
            <Link
              key={tab.key}
              href={`/${locale}/admin/${tab.path}`}
              aria-current={isActive ? "page" : undefined}
              // Цвет из закрытой палитры, не из ввода человека, поэтому он идёт
              // стилем: Tailwind не умеет классов, которых нет при сборке.
              style={
                hex
                  ? { borderColor: hex, backgroundColor: isActive ? `${hex}26` : undefined }
                  : undefined
              }
              className={`${ADMIN_TAB} ${
                hex
                  ? isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground"
                  : isActive
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-hairline text-muted hover:border-accent/60 hover:text-foreground"
              }`}
            >
              {t(`tabs.${tab.key}`)}
            </Link>
          );
        })}
        <Link
          href={`/${locale}/admin/appearance`}
          title={t("appearance.title")}
          aria-label={t("appearance.title")}
          aria-current={active === "appearance" ? "page" : undefined}
          className={`${ADMIN_TAB} ${
            active === "appearance"
              ? "border-accent bg-accent/15 text-foreground"
              : "border-hairline text-muted hover:border-accent/60 hover:text-foreground"
          }`}
        >
          🎨
        </Link>
        <AdminBell locale={locale} />
      </div>
    </nav>
  );
}
