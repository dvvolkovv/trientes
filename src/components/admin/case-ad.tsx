import { getTranslations } from "next-intl/server";
import { AdBanner } from "@/components/company-card/ad-banner";
import type { CardAd } from "@/lib/company-card/view";
import type { AdDiffRow } from "@/lib/ads/moderation";

/**
 * Материал в деле (слайс CC): модератор смотрит **тот же баннер**, что увидит
 * посетитель, — со звуком и роликом. Второй «как это будет выглядеть» разошёлся бы
 * с настоящим: болезнь, уже стоившая проекту двух сборок одной витрины (BX).
 *
 * У ждущей правки опубликованного материала под баннером стоит «было → стало»:
 * решение принимается про изменение, а не про материал целиком.
 */
export async function CaseAd({
  ad,
  diff,
  revision,
}: {
  ad: CardAd;
  diff: AdDiffRow[];
  /** Правка опубликованного, а не первая публикация. */
  revision: boolean;
}) {
  const t = await getTranslations("admin");

  return (
    <div>
      <p className="mb-2 text-[12px] text-muted">
        {revision ? t("case.ad.revisionHint") : t("case.ad.publishHint")}
      </p>
      <AdBanner ads={[ad]} />
      {revision ? (
        diff.length > 0 ? (
          <dl className="mt-3 flex flex-col">
            {diff.map((row) => (
              <div key={row.field} className="border-b border-hairline py-2 last:border-b-0">
                {/* Код поля на экране — та же жалоба, что `TASK_CREATED` в журнале
                    (живой прогон BF): новым полям положены слова. Незнакомое поле
                    показывается как есть: список полей меняется чаще переводов. */}
                <dt className="text-[11px] uppercase tracking-wider text-muted">
                  {t.has(`case.ad.field.${row.field}`) ? t(`case.ad.field.${row.field}`) : row.field}
                </dt>
                <dd className="mt-0.5 break-words text-[12.5px]">
                  <span className="text-muted line-through">{row.from}</span>
                  <span className="mx-1.5 text-muted">→</span>
                  <span className="font-semibold">{row.to}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          // Правка без различий — не повод молчать: проверяющий должен понимать,
          // почему дело открыто, а не искать разницу глазами.
          <p className="mt-3 text-[12px] text-muted">{t("case.ad.noChanges")}</p>
        )
      ) : null}
    </div>
  );
}
