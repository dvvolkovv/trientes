import { getTranslations } from "next-intl/server";
import { validateLegal, type JurisdictionStatus } from "@/lib/coin-card-legal";
import { countryName } from "@/lib/countries";
import { ExternalLink } from "../external-link";

/**
 * Правовой статус по юрисдикциям (слайс F4).
 *
 * Это не наш вывод о законности, а заявление проекта со ссылкой на источник и
 * датой — поэтому дисклеймер стоит постоянно, а у каждой записи видны источник
 * и дата. Без них запись просто не сохраняется (validateLegal).
 *
 * UNCLEAR рисуется наравне с остальными: «неясно» — это честный ответ, а не
 * пропуск.
 */
const TONE: Record<JurisdictionStatus, string> = {
  ALLOWED: "text-up border-up/40",
  LICENSED: "text-foreground border-hairline",
  RESTRICTED: "text-accent border-accent/40",
  BANNED: "text-down border-down/40",
  UNCLEAR: "text-muted border-hairline",
};

export async function LegalSection({ legal }: { legal: unknown }) {
  const t = await getTranslations("coinCard.legal");
  const v = validateLegal(legal);
  if (!v.ok || v.data.jurisdictions.length === 0) return null;

  return (
    <section id="legal" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-2">
        {t("title")}
      </h2>
      {/* Дисклеймер первым, до любых статусов: иначе его прочитают последним. */}
      <p className="text-[13px] text-muted mb-4 max-w-[75ch]">{t("disclaimer")}</p>

      <div className="overflow-x-auto border border-hairline rounded-md">
        <table className="w-full text-sm">
          <thead className="text-muted text-[12px] uppercase tracking-[0.15em]">
            <tr className="border-b border-hairline">
              <th className="text-left px-4 py-3">{t("country")}</th>
              <th className="text-left px-4 py-3">{t("status")}</th>
              <th className="text-left px-4 py-3">{t("note")}</th>
              <th className="text-right px-4 py-3">{t("source")}</th>
            </tr>
          </thead>
          <tbody>
            {v.data.jurisdictions.map((j) => (
              <tr key={j.countryCode} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3">{countryName(j.countryCode) ?? j.countryCode}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block text-[11px] uppercase tracking-[0.12em] px-2 py-0.5 rounded border ${TONE[j.status]}`}
                  >
                    {t(`status_${j.status}`)}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted max-w-[42ch]">{j.note ?? "—"}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <ExternalLink href={j.sourceUrl} className="text-accent">
                    {t("sourceLink")}
                  </ExternalLink>
                  <span className="num text-[11px] text-muted ml-2">{j.asOf}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
