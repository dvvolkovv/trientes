import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { CreateGeoAlertForm } from "@/components/cabinet/create-geo-alert-form";
import { GeoAlertRow } from "@/components/cabinet/geo-alert-row";

export async function GeoAlertsBlock({ userId }: { userId: string }) {
  const t = await getTranslations("cabinet.geoAlerts");
  const rows = await prisma.geoAlert.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, countryCode: true, enabled: true,
      notifyFintech: true, notifyPoints: true,
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("title")}</h3>
        <p className="text-xs text-muted mt-1">{t("subtitle")}</p>
      </div>

      <CreateGeoAlertForm />

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <GeoAlertRow {...r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
