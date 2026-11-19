import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { readTaskReports, readTaskTargets, readTasks, type TaskRow } from "@/lib/company-tasks/read";
import { boardColumns, isOverdue, isTaskStatus, taskRightsFor } from "@/lib/company-tasks/rules";
import { TaskCreateForm } from "@/components/tasks/task-create-form";

export const dynamic = "force-dynamic";

/**
 * Доска задач. Доска и список — одно и то же чтение, разложенное по статусам (спека,
 * § 2.7); фильтры идут параметрами адреса, чтобы ссылка на «мои просроченные»
 * пересылалась. Раздел виден каждому члену: свои задачи есть у каждого (§ 2.1).
 */
export default async function CompanyTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ status?: string; assignee?: string; point?: string; overdue?: string; mine?: string }>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetTasks");
  const format = await getFormatter();
  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const rights = taskRightsFor({
    suspendedAt: company.suspendedAt,
    deletedAt: company.deletedAt,
    permissions,
  });
  const viewer = { userId, seeAll: rights.seeAll, pointScope };
  const now = new Date();

  const filters = {
    status: query.status && isTaskStatus(query.status) ? query.status : null,
    assigneeId: query.mine === "1" ? userId : query.assignee || null,
    pointId: query.point || null,
    overdue: query.overdue === "1",
  };

  const [rows, targets, reports] = await Promise.all([
    readTasks(company.id, viewer, filters, { now }),
    rights.manage ? readTaskTargets(company.id, pointScope) : Promise.resolve(null),
    rights.seeAll ? readTaskReports(company.id, viewer, { now }) : Promise.resolve(null),
  ]);

  const base = `/${locale}/cabinet/companies/${company.id}/tasks`;
  const columns = boardColumns();
  const cancelled = rows.filter((r) => r.status === "CANCELLED");

  const chip = (href: string, text: string, active: boolean) => (
    <Link
      key={href + text}
      href={href}
      className={`inline-flex items-center h-10 px-3 rounded-md border text-[13px] ${
        active ? "border-accent text-foreground" : "border-hairline text-muted"
      }`}
    >
      {text}
    </Link>
  );

  function card(row: TaskRow) {
    const overdue = isOverdue({ status: row.status, dueAt: row.dueAt }, now);
    return (
      <Link
        key={row.id}
        href={`${base}/${row.id}`}
        className="block border border-hairline rounded-lg p-3 hover:border-accent"
      >
        <div className="text-sm font-medium leading-snug">{row.title}</div>
        <div className="text-[11px] text-muted mt-1">
          {t(`priorities.${row.priority}`)}
          {row.dueAt ? ` · ${format.dateTime(row.dueAt, { dateStyle: "medium" })}` : ""}
          {overdue ? ` · ${t("overdue")}` : ""}
        </div>
        <div className="text-[11px] text-muted">
          {row.takenBy?.label ?? row.assignee?.label ?? t("nobody")}
          {row.pointName ? ` · ${row.pointName}` : ""}
          {row.comments > 0 ? ` · 💬 ${row.comments}` : ""}
        </div>
      </Link>
    );
  }

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-12 py-10">
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h1>
        <p className="text-muted text-sm">{rights.seeAll ? t("subtitle") : t("subtitleOwn")}</p>
      </header>

      {!rights.active ? (
        <p className="text-sm text-muted border border-hairline rounded-md p-3 mb-6">{t("frozen")}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-6">
        {chip(base, t("filters.all"), !query.mine && !query.overdue && !query.status)}
        {chip(`${base}?mine=1`, t("filters.mine"), query.mine === "1" && query.overdue !== "1")}
        {chip(`${base}?overdue=1`, t("filters.overdue"), query.overdue === "1" && query.mine !== "1")}
        {chip(`${base}?mine=1&overdue=1`, t("filters.mineOverdue"), query.mine === "1" && query.overdue === "1")}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted text-sm mb-8">{t("empty")}</p>
      ) : (
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          {columns.map((status) => {
            const items = rows.filter((r) => r.status === status);
            return (
              <section key={status}>
                <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">
                  {t(`statuses.${status}`)} · <span className="num">{items.length}</span>
                </h2>
                <div className="space-y-2">{items.map(card)}</div>
              </section>
            );
          })}
        </div>
      )}

      {cancelled.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{t("statuses.CANCELLED")}</h2>
          <div className="grid md:grid-cols-4 gap-2">{cancelled.map(card)}</div>
        </section>
      ) : null}

      {rights.manage && targets ? (
        <section className="mb-8">
          <TaskCreateForm
            companyId={company.id}
            members={targets.members.map((m) => ({ id: m.id, label: m.label }))}
            points={targets.points.map((p) => ({ id: p.id, label: p.name }))}
            products={targets.products.map((p) => ({ id: p.id, label: p.name }))}
            warehouses={targets.warehouses.map((w) => ({ id: w.id, label: w.name }))}
          />
        </section>
      ) : null}

      {reports ? (
        <section className="space-y-6">
          <h2 className="text-[20px] font-bold tracking-[-0.02em]">{t("reports.title")}</h2>
          <p className="text-[12px] text-muted">{t("reports.note")}</p>
          {[
            { heading: t("reports.byAssignee"), rows: reports.byAssignee, fallback: t("nobody") },
            { heading: t("reports.byPoint"), rows: reports.byPoint, fallback: t("reports.noPoint") },
          ].map((block) => (
            <div key={block.heading}>
              <h3 className="text-xs uppercase tracking-[0.2em] text-muted mb-2">{block.heading}</h3>
              {block.rows.length === 0 ? (
                <p className="text-sm text-muted">{t("reports.empty")}</p>
              ) : (
                <ul className="space-y-1">
                  {block.rows.map((row) => (
                    <li key={row.key} className="border border-hairline rounded-md px-3 py-2 text-sm flex flex-wrap gap-x-4">
                      <span className="font-medium">{row.label || block.fallback}</span>
                      <span className="text-muted num">{t("reports.open", { count: row.open })}</span>
                      <span className="text-muted num">{t("reports.overdue", { count: row.overdue })}</span>
                      <span className="text-muted num">{t("reports.onReview", { count: row.onReview })}</span>
                      <span className="text-muted num">{t("reports.done30", { count: row.doneRecently })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
