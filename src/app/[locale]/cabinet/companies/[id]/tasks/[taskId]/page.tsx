import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { getViewerCompanyById } from "@/lib/business";
import { readTask, readTaskTargets } from "@/lib/company-tasks/read";
import { TASK_STATUSES, canTransition, isOverdue, taskRightsFor, type TaskStatus } from "@/lib/company-tasks/rules";
import { TaskActions } from "@/components/tasks/task-actions";
import { TaskThread } from "@/components/tasks/task-thread";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/** Одна задача: поля, разрешённые переходы и обсуждение. */
export default async function CompanyTaskPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; taskId: string }>;
}) {
  const { locale, id, taskId } = await params;
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
  const task = await readTask(company.id, taskId, { userId, seeAll: rights.seeAll, pointScope });
  if (!task) notFound();

  // Какие переходы доступны — решает то же правило, что и действие: вторая копия
  // правила в браузере разошлась бы с первой.
  const moves: TaskStatus[] = rights.active
    ? TASK_STATUSES.filter((to) =>
        canTransition(
          {
            status: task.status,
            createdById: task.createdById,
            assigneeId: task.assigneeId,
            takenById: task.takenById,
            submittedById: task.submittedById,
          },
          to,
          { userId, manage: rights.manage },
        ).ok,
      )
    : [];

  const targets = rights.manage ? await readTaskTargets(company.id, pointScope) : null;
  const overdue = isOverdue({ status: task.status, dueAt: task.dueAt }, new Date());
  const handedInByViewer = task.status === "ON_REVIEW" && task.submittedById === userId;
  const showActions = moves.length > 0 || handedInByViewer;
  const base = `/${locale}/cabinet/companies/${company.id}/tasks`;

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
        <Link href={base} className="hover:text-foreground">{t("title")}</Link>
      </nav>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">{task.title}</h1>
          <span className="text-xs px-2 py-1 rounded bg-card border border-hairline">{t(`statuses.${task.status}`)}</span>
          {overdue ? <span className="text-xs px-2 py-1 rounded bg-red-500/15 text-red-400">{t("overdue")}</span> : null}
        </div>
        <p className="text-[12px] text-muted">
          {t("meta.priority", { value: t(`priorities.${task.priority}`) })}
          {task.dueAt ? ` · ${t("meta.due", { value: format.dateTime(task.dueAt, { dateStyle: "medium" }) })}` : ""}
        </p>
      </header>

      {task.details ? (
        <p className="text-sm whitespace-pre-wrap mb-6">{task.details}</p>
      ) : null}

      <section className="mb-8 grid md:grid-cols-2 gap-2 text-sm">
        {/* «Кто получил» и «кто взял» — два разных поля: ТЗ просит видеть оба. */}
        <div className="border border-hairline rounded-md px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("meta.author")}</div>
          <div>{task.createdByPerson?.label ?? t("gone")}</div>
        </div>
        <div className="border border-hairline rounded-md px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("meta.assignee")}</div>
          <div>{task.assigneePerson?.label ?? t("nobody")}</div>
        </div>
        <div className="border border-hairline rounded-md px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("meta.taken")}</div>
          <div>
            {task.takenByPerson?.label ?? t("nobody")}
            {task.takenAt ? ` · ${format.dateTime(task.takenAt, { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </div>
        </div>
        <div className="border border-hairline rounded-md px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("meta.links")}</div>
          <div className="text-muted">
            {[task.point?.name, task.product?.name, task.warehouse?.name].filter(Boolean).join(" · ") || t("fields.none")}
          </div>
        </div>
        {task.closedAt ? (
          <div className="border border-hairline rounded-md px-3 py-2 md:col-span-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{t("meta.closed")}</div>
            <div>
              {task.closedByPerson?.label ?? t("gone")} · {format.dateTime(task.closedAt, { dateStyle: "medium", timeStyle: "short" })}
              {task.cancelReason ? ` · ${task.cancelReason}` : ""}
            </div>
          </div>
        ) : null}
      </section>

      {/* Раздел показывается и тогда, когда действий нет: сдавшему задачу надо сказать
          словами, почему у него нет кнопки «выполнено». Живой прогон 19 ноября поймал
          ровно это — работник видел «на проверке» и больше ничего. */}
      {showActions ? (
        <section className="mb-8">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("actionsHeading")}</h2>
          <TaskActions
            companyId={company.id}
            taskId={task.id}
            status={task.status}
            moves={moves}
            manage={rights.manage}
            assigneeId={task.assigneeId}
            members={(targets?.members ?? []).map((m) => ({ id: m.id, label: m.label }))}
          />
          {/* Исполнитель своё не принимает: «на проверке» иначе слово, которое никто не
              читает. Поэтому у сдавшего кнопки «выполнено» нет, и это сказано словами. */}
          {handedInByViewer ? (
            <p className="text-[12px] text-muted mt-2">{t("waitingAcceptance")}</p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("threadHeading")}</h2>
        <TaskThread companyId={company.id} taskId={task.id}>
          {task.thread.length === 0 ? (
            <p className="text-sm text-muted">{t("threadEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {task.thread.map((c) => (
                <li key={c.id} className="border border-hairline rounded-md px-3 py-2">
                  <div className="text-[11px] text-muted mb-0.5">
                    {c.author?.label ?? t("gone")} · {format.dateTime(c.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{c.body}</div>
                </li>
              ))}
            </ul>
          )}
        </TaskThread>
      </section>
    </main>
  );
}
