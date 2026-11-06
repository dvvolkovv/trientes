import { getTranslations } from "next-intl/server";

/**
 * Маркер машинного перевода. На этой карточке каждое значение говорит, откуда
 * взято; перевод заявления проекта — производный текст, а не само заявление,
 * поэтому подменять одно другим молча нельзя. Рядом — ссылка на оригинал.
 *
 * Визуальный язык тот же, что у ProvenanceBadge: новых форм и цветов не вводим.
 */
export async function TranslatedBadge({ originalHref }: { originalHref: string }) {
  const t = await getTranslations("common");
  return (
    <span className="inline-flex items-center gap-2 ml-2 align-middle">
      <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-hairline text-muted">
        {t("machineTranslated")}
      </span>
      <a href={originalHref} className="text-[10px] underline text-muted hover:text-foreground">
        {t("showOriginal")}
      </a>
    </span>
  );
}
