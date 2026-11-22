import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminBell } from "./admin-bell";
import { loadViewerAccess } from "@/lib/authz/guard";
import { canAny, canOwnerOnly } from "@/lib/authz/policy";
import { readViewerSectionColors } from "@/lib/admin-appearance";
import { sectionColorHex } from "@/lib/section-colors";
import { ADMIN_TAB, ADMIN_TAB_STRIP, adminChoiceLook } from "@/lib/admin-ui";
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
          const isActive = active === tab.key;
          const look = adminChoiceLook(sectionColorHex(colors, tab.key), isActive);
          return (
            <Link
              key={tab.key}
              href={`/${locale}/admin/${tab.path}`}
              aria-current={isActive ? "page" : undefined}
              style={look.style}
              className={`${ADMIN_TAB} ${look.className}`}
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
          className={`${ADMIN_TAB} ${adminChoiceLook(null, active === "appearance").className}`}
        >
          🎨
        </Link>
        <AdminBell locale={locale} />
      </div>
    </nav>
  );
}
