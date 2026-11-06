import { getLocale, getTranslations } from "next-intl/server";
import { getFiatRoutes } from "@/lib/card-fiat-routes";
import { countryName } from "@/lib/countries";
import { ProvenanceBadge } from "../provenance-badge";

/**
 * Путь к фиату (слайс F3): через кого монету принять и вывести в деньги.
 * Берётся из уже существующего каталога финтеха — новых сущностей не
 * вводится, только связь supportedCardIds.
 *
 * Ноль — это ноль: если сервисов нет, блок говорит это прямо, а не исчезает.
 * Скрытый блок читается как обман, когда пользователь найдёт его у другой
 * монеты.
 */
export async function FiatRoutesBlock({ cardId }: { cardId: string }) {
  const [t, tf, locale] = await Promise.all([
    getTranslations("coinCard.fiat"),
    getTranslations("fintech"),
    getLocale(),
  ]);
  const routes = await getFiatRoutes(cardId);

  const chip =
    "inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-hairline text-muted";
  const label = "text-[12px] uppercase tracking-[0.15em] text-muted";

  return (
    <div className="border border-hairline rounded-md p-5 space-y-4">
      <div className={label}>
        {t("title")}
        <ProvenanceBadge
          entry={{ kind: "AGGREGATED", source: t("source"), at: new Date().toISOString() }}
        />
      </div>

      {routes.rows.length === 0 ? (
        <p className="text-[13px] text-muted max-w-[70ch]">{t("empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {routes.byService.map((s) => (
              <span key={s.service} className={chip}>
                {tf(`services.${s.service}`)}{" "}
                <span className="num text-foreground">{s.count}</span>
              </span>
            ))}
          </div>

          <ul className="border-y border-hairline">
            {routes.rows.map((r) => (
              <li key={r.id} className="border-b border-hairline last:border-0">
                <a
                  href={`/${locale}/fintech/${r.slug}`}
                  className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 hover:text-accent"
                >
                  <span className="text-[14px]">
                    {r.displayName}
                    {r.kycLevel ? (
                      <span className="ml-2 text-[11px] text-muted">
                        {tf(`kyc.${r.kycLevel}`)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[12px] text-muted">
                    {r.services.map((s) => tf(`services.${s}`)).join(" · ")}
                  </span>
                </a>
              </li>
            ))}
          </ul>

          {(routes.countries.length > 0 || routes.fiats.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {routes.countries.length > 0 && (
                <div className="space-y-1">
                  <div className={label}>{t("countries")}</div>
                  <p className="text-[13px]">
                    {routes.countries.map((c) => countryName(c) ?? c).join(", ")}
                  </p>
                </div>
              )}
              {routes.fiats.length > 0 && (
                <div className="space-y-1">
                  <div className={label}>{t("fiats")}</div>
                  <p className="text-[13px] num">{routes.fiats.join(", ")}</p>
                </div>
              )}
            </div>
          )}

          {routes.hasMore && (
            <p className="text-[13px]">
              <a href={`/${locale}/fintech`} className="underline text-muted hover:text-foreground">
                {t("all")}
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
