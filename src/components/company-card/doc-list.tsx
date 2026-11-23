import { getTranslations } from "next-intl/server";
import { docRubricKey, isCompanyDocKind } from "@/lib/company-docs";
import type { CardDoc } from "@/lib/company-card/view";
import { CARD_HEADING, CARD_PANEL } from "@/lib/company-card-ui";

/**
 * Бумаги списком по рубрикам — одна сборка на две поверхности (слайс CB): документы
 * предприятия на витрине и документы объявления на его странице. Вторая копия этой
 * разметки разошлась бы с первой, как уже расходились две сборки витрины (BX).
 *
 * У бумаги две разные ссылки, и путать их нельзя: **наш файл** подтверждает только
 * то, что продавец его загрузил, а **ссылка на реестр** — место, где бумагу
 * проверяют. Поэтому вторая строка своя и названа своими словами (правило BV).
 */
export async function DocList({
  docs,
  heading,
}: {
  docs: CardDoc[];
  heading: string;
}) {
  const tb = await getTranslations("business");

  const groups: { key: string; label: string; rows: CardDoc[] }[] = [];
  for (const d of docs) {
    if (!isCompanyDocKind(d.kind)) continue;
    const key = docRubricKey(d.kind, d.kindCustom);
    const label = d.kind === "other" && d.kindCustom ? d.kindCustom : tb(`docs.kind.${d.kind}`);
    const found = groups.find((g) => g.key === key);
    if (found) found.rows.push(d);
    else groups.push({ key, label, rows: [d] });
  }
  if (groups.length === 0) return null;

  return (
    <section className={CARD_PANEL}>
      <h2 className={CARD_HEADING}>{heading}</h2>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">{g.label}</div>
            <ul className="space-y-1.5">
              {g.rows.map((d) => (
                <li key={d.id}>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
                      {d.title ?? g.label}
                    </a>
                  ) : (
                    <span className="text-sm">{d.title ?? g.label}</span>
                  )}
                  {d.linkUrl ? (
                    <a
                      href={d.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-0.5 block text-[12px] text-muted underline"
                    >
                      {tb("docs.verifyLink")} ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
