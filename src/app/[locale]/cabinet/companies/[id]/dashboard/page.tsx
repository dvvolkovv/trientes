import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { CabinetTile, TILE_GRID } from "@/components/cabinet/cabinet-tile";
import { CabinetBackButton } from "@/components/cabinet/back-button";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { visibleDashCards, type DashCardKey } from "@/lib/dashboard/cards";
import { readDashboard, type DashMoney } from "@/lib/dashboard/read";

export const dynamic = "force-dynamic";

/**
 * Сводка рабочего дня (слайс CM, ТЗ 6.6 «Единая панель управления с дашбордом»). Спека
 * `docs/superpowers/specs/2026-11-25-merchant-dashboard-design.md`.
 *
 * Пять чисел ТЗ, и ни одного своего: каждое читается тем правилом, что рисует раздел.
 * Плитка видна только по праву на свой раздел — иначе сводка была бы обходом модели
 * прав BE. Задачи видны каждому члену (BF), поэтому сводка есть у всякого члена, а
 * пустой состав — страховка на случай, если плитку «для всех» однажды уберут.
 *
 * Сравнения с прошлым периодом нет: сегодняшний день не закончен, и «−40 % к неделе»
 * в полдень — ложная тревога (§ 6 спеки).
 */
export default async function CompanyDashboardPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetDashboard");
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const cards = visibleDashCards(permissions);
  if (cards.length === 0) notFound();

  const dash = await readDashboard(company.id, { userId, permissions, pointScope });
  const base = `/${locale}/cabinet/companies/${company.id}`;

  const money = (rows: DashMoney[]) =>
    rows
      .map((r) => new Intl.NumberFormat(locale, { style: "currency", currency: r.currency }).format(r.revenue))
      .join(" · ");

  const view = (key: DashCardKey): { value: number; hint: string; badge: string | null } | null => {
    if (key === "sales") {
      const s = dash.sales;
      if (!s) return null;
      const todayMoney = s.todayMoney.length > 0 ? money(s.todayMoney) : t("sales.noMoney");
      return {
        value: s.today,
        hint: `${todayMoney} · ${t("sales.week", { count: s.week })}`,
        badge: s.cancelledToday > 0 ? t("sales.cancelled", { count: s.cancelledToday }) : null,
      };
    }
    if (key === "stock") {
      const s = dash.stock;
      if (!s) return null;
      return {
        value: s.outOfStock,
        hint: `${t("stock.below", { count: s.belowThreshold })} · ${t("stock.transit", { count: s.inTransit })}`,
        badge: null,
      };
    }
    if (key === "tasks") {
      const s = dash.tasks;
      if (!s) return null;
      return {
        value: s.open,
        hint: `${t("tasks.mine", { count: s.mine })} · ${t("tasks.review", { count: s.onReview })}`,
        badge: s.overdue > 0 ? t("tasks.overdue", { count: s.overdue }) : null,
      };
    }
    if (key === "promos") {
      const s = dash.promos;
      if (!s) return null;
      return {
        value: s.running,
        hint: `${t("promos.left", { count: s.sendsLeft })} · ${t("promos.live", { count: s.adsLive })}`,
        badge: s.adsPending > 0 ? t("promos.pending", { count: s.adsPending }) : null,
      };
    }
    const s = dash.customers;
    if (!s) return null;
    return { value: s.unread, hint: t("customers.threads", { count: s.threads }), badge: null };
  };

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <CabinetBackButton locale={locale} />
      <div>
        <Link href={base} className="text-[12px] text-muted underline">
          ← {company.displayName}
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-[26px] font-bold tracking-[-0.03em]">
          <span>📈</span>
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>

      <div className={TILE_GRID}>
        {cards.map((def) => {
          const v = view(def.key);
          if (!v) return null;
          return (
            <CabinetTile
              key={def.key}
              href={`${base}/${def.path}`}
              icon={def.icon}
              label={t(`tile.${def.key}` as never)}
              value={v.value}
              hint={v.hint}
              badge={v.badge}
            />
          );
        })}
      </div>

      {dash.sales ? (
        <section className="space-y-1 rounded-[12px] border border-border bg-card p-4">
          <h2 className="text-[12px] uppercase tracking-[0.2em] text-muted">{t("week.heading")}</h2>
          <p className="text-[14px] font-semibold">
            {dash.sales.weekMoney.length > 0 ? money(dash.sales.weekMoney) : t("sales.noMoney")}
          </p>
          <p className="text-[12px] text-muted">{t("sales.week", { count: dash.sales.week })}</p>
        </section>
      ) : null}

      <p className="text-[12px] leading-snug text-muted">
        {t("timezoneNote", { tz: dash.tz })}
        {dash.tzMixed ? ` ${t("timezoneMixed")}` : ""}
      </p>

      {dash.sales?.truncated ? (
        <p className="rounded-[12px] border border-down/40 bg-card p-3 text-[12.5px] leading-snug text-down">
          {t("truncated")}
        </p>
      ) : null}
    </main>
  );
}
