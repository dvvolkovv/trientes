import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { readViewerRoutePrefs } from "@/lib/interests-read";
import { InterestsControls } from "@/components/cabinet/interests-controls";

/**
 * «Интересы и маршруты» (ТЗ 4.4): что подбирать по пути и за сколько предупреждать
 * голосом. Настройка человека, а не предприятия, поэтому стоит в кабинете покупателя —
 * и у сотрудника платформы она ровно такая же.
 */
export async function InterestsSection() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return null;

  const [t, prefs] = await Promise.all([
    getTranslations("cabinetInterests"),
    readViewerRoutePrefs(userId),
  ]);

  return (
    <section id="interests">
      {/* Заголовок печатает оболочка раздела — см. `subscriptions-section`. */}
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>
      <InterestsControls
        marks={Object.fromEntries(prefs.marks.map((m) => [m.key, m.verdict]))}
        corridor={prefs.corridorMeters}
        alert={prefs.alertMeters}
      />
    </section>
  );
}
