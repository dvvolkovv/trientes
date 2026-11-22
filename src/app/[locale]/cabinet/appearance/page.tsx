import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { isStaffRole, type ViewerRole } from "@/lib/authz/policy";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { SectionColorPicker } from "@/components/admin/section-color-picker";
import { ResetColorsButton } from "@/components/admin/reset-colors-button";
import { readViewerSectionColors } from "@/lib/admin-appearance";
import { SECTION_COLOR_KEYS } from "@/lib/section-colors";
import { cabinetColorKey, visibleCabinetTiles } from "@/lib/cabinet/personal-nav";

export const dynamic = "force-dynamic";

/**
 * «Вид разделов» кабинета: тот же механизм, что у админки, та же палитра и то
 * же хранилище. Права на страницу не заводим — это личный вид своего кабинета.
 */
export default async function CabinetAppearancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale, "/cabinet/appearance");
  const t = await getTranslations();
  const colors = await readViewerSectionColors();
  const tiles = visibleCabinetTiles(isStaffRole(user.role as ViewerRole));
  const colorNames = Object.fromEntries(
    SECTION_COLOR_KEYS.map((key) => [key, t(`common.colors.${key}`)]),
  );

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.appearance.title")}
      backLabel={t("cabinet.hub.back")}
    >
      <p className="mb-5 text-sm text-muted">{t("cabinet.appearance.subtitle")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <SectionColorPicker
            // Ключ несёт текущий цвет: после «сбросить всё» сервер отдаёт пустой
            // словарь, ключ меняется, и образец перерисовывается с нуля.
            key={`${tile.key}:${colors[cabinetColorKey(tile.key)] ?? "none"}`}
            section={cabinetColorKey(tile.key)}
            label={t(tile.labelKey)}
            icon={tile.icon}
            sample="tile"
            initial={colors[cabinetColorKey(tile.key)] ?? null}
            noneLabel={t("common.colors.none")}
            colorNames={colorNames}
          />
        ))}
      </div>
      <div className="mx-auto mt-6 max-w-[320px]">
        <ResetColorsButton label={t("cabinet.appearance.reset")} />
      </div>
    </CabinetSectionShell>
  );
}
