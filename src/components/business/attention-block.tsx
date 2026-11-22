import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { CompanyAttention } from "@/lib/cabinet/company-attention";

/**
 * «Требует внимания» (слайс BV): за колокольчиком на плитке должно быть видно, что
 * именно звенело. Колокольчик, за которым не видно дела, — раздражитель.
 *
 * Блока нет вовсе, когда непрочитанного нет: пустой раздел «внимание» приучает его
 * не читать (правило AA про ночной отчёт).
 */
export async function AttentionBlock({
  locale,
  companyId,
  attention,
}: {
  locale: string;
  companyId: string;
  attention: CompanyAttention;
}) {
  if (attention.total === 0) return null;
  const t = await getTranslations("business.attention");
  const tc = await getTranslations("cabinet.cases");

  const row =
    "flex min-h-12 items-center justify-between gap-3 rounded-[14px] border border-hairline bg-card px-3 py-2 text-[13px] transition-colors hover:border-accent/60";
  const badge = "shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground";

  return (
    <section className="space-y-2 rounded-[22px] border border-accent/40 bg-accent/5 p-3 md:p-4">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-accent">{t("title")}</h2>
      {attention.customers > 0 ? (
        <Link href={`/${locale}/cabinet/companies/${companyId}/inbox`} className={row}>
          <span>✉️ {t("customers")}</span>
          <span className={badge}>{attention.customers}</span>
        </Link>
      ) : null}
      {attention.cases.map((c) => (
        <Link key={c.caseId} href={`/${locale}/cabinet/cases/${c.caseId}`} className={row}>
          <span className="min-w-0">
            <b className="block truncate font-semibold">🛡️ {c.title}</b>
            <span className="text-[11px] text-muted">{tc(`status.${c.status}`)}</span>
          </span>
          <span className={badge}>{c.unread}</span>
        </Link>
      ))}
    </section>
  );
}
