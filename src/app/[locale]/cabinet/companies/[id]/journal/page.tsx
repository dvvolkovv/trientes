import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById, canManageMembers } from "@/lib/business";
import { JOURNAL_PAGE, readJournal } from "@/lib/company-team/journal";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Журнал действий предприятия (ТЗ 6.6: «кто, что и когда изменил»). Видит владелец:
 * остальным журнал показывал бы, кто из их коллег что правил, — это решение владельца.
 */
export default async function CompanyJournalPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetJournal");
  const format = await getFormatter();
  const { userId, company, role } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canManageMembers(role)) notFound();

  const rows = await readJournal(company.id);

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-10">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h1>
        <p className="text-muted text-sm">{t("subtitle", { count: JOURNAL_PAGE })}</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="border border-hairline rounded-md px-3 py-2.5">
              <div className="text-sm">
                {/* Код действия переводится; незнакомый код показывается как есть —
                    журнал неизменяем, и строка старого вида должна остаться читаемой. */}
                {t.has(`actions.${row.action}`) ? t(`actions.${row.action}`) : row.action}
                {row.subject ? <span className="text-muted"> · {row.subject}</span> : null}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {row.actor?.username ??
                  row.actor?.name ??
                  row.actor?.email ??
                  // Пустой автор означает две разные вещи: участника удалили (связь
                  // `SET NULL`) или строку написал ночной прогон. Прогон помечает себя
                  // сам — иначе журнал подписывал бы его «удалённым участником».
                  ((row.meta as { by?: string } | null)?.by === "system" ? t("systemActor") : t("goneActor"))}
                {" · "}
                {format.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
