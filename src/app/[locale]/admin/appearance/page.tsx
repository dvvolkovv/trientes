import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminNav } from "@/components/admin/nav";
import { SectionColorPicker } from "@/components/admin/section-color-picker";
import { ResetColorsButton } from "@/components/admin/reset-colors-button";
import { loadViewerAccess } from "@/lib/authz/guard";
import { canAny, canOwnerOnly, visibleQueues } from "@/lib/authz/policy";
import { readViewerSectionColors } from "@/lib/admin-appearance";
import { ADMIN_SECTIONS, SECTION_COLOR_KEYS } from "@/lib/admin-sections";
import { ADMIN_TABS } from "@/lib/admin-tabs";
import { ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminAppearancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const access = await loadViewerAccess();
  const now = new Date();
  const colors = await readViewerSectionColors();

  // Видны только доступные разделы: настраивать чужую очередь незачем, а её имя
  // в списке выдавало бы её существование — то же правило, по которому плитки
  // очередей рисуются только для выданных прав.
  const allowed = new Set<string>();
  if (access) {
    for (const q of visibleQueues(access, now)) allowed.add(q);
    for (const tab of ADMIN_TABS) {
      if (tab.owner ? canOwnerOnly(access) : tab.queues ? canAny(access, tab.queues, "VIEW", now) : true) {
        allowed.add(tab.key);
      }
    }
  }
  const sections = ADMIN_SECTIONS.filter((s) => allowed.has(s.key));
  const colorNames = Object.fromEntries(
    SECTION_COLOR_KEYS.map((key) => [key, t(`appearance.colors.${key}`)]),
  );

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="appearance" />
      <header className="mb-6 text-center">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">
          {t("appearance.kicker")}
        </div>
        <h1 className="mb-1 text-[32px] font-bold tracking-[-0.03em]">{t("appearance.title")}</h1>
        <p className="text-sm text-muted">{t("appearance.subtitle")}</p>
      </header>

      {sections.length === 0 ? (
        <p className="text-center text-sm text-muted">{t("errors.no_access")}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {sections.map((section) => (
              <SectionColorPicker
                // Ключ несёт текущий цвет: после «сбросить всё» сервер отдаёт
                // пустой словарь, ключ меняется, и образец перерисовывается с
                // нуля. Без этого состояние пикера пережило бы сброс и показывало
                // цвет, которого в базе уже нет (поймано живым прогоном).
                key={`${section.key}:${colors[section.key] ?? "none"}`}
                section={section.key}
                label={t(section.labelKey)}
                initial={colors[section.key] ?? null}
                noneLabel={t("appearance.none")}
                colorNames={colorNames}
              />
            ))}
          </div>
          <div className="mx-auto mt-6 max-w-[320px]">
            <ResetColorsButton label={t("appearance.reset")} />
          </div>
        </>
      )}
    </div>
  );
}
