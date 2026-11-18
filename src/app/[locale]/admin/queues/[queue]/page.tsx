import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { myLevel, requireQueue } from "@/lib/authz/guard";
import { AdminNav } from "@/components/admin/nav";
import { CaseRowCard } from "@/components/admin/case-row";
import { queueByKey } from "@/lib/cases/queues";
import { slaState } from "@/lib/cases/sla";
import { formatHandled } from "@/lib/cases/time";
import { OPEN_STATUSES } from "@/lib/cases/types";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { QueueSpamList } from "@/components/admin/queue-spam";
import { isSpamClosable } from "@/lib/cases/spam";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage({
  params,
}: {
  params: Promise<{ locale: string; queue: string }>;
}) {
  const { locale, queue } = await params;
  setRequestLocale(locale);
  const def = queueByKey(queue);
  if (!def) notFound();
  // Недоступная очередь отвечает «нет такой страницы»: по коду отказа не должно
  // быть видно, какие очереди в системе есть.
  if (!(await requireQueue(def.key, "VIEW")).ok) notFound();

  const t = await getTranslations("admin");
  const now = new Date();

  const cases = await prisma.complianceCase.findMany({
    where: { subjectType: { in: def.subjectTypes }, status: { in: OPEN_STATUSES } },
    orderBy: { dueAt: "asc" },
    take: 100,
    include: { assignee: { select: { name: true, username: true } } },
  });

  const unreadRows = await prisma.caseMessage.groupBy({
    by: ["caseId"],
    where: { caseId: { in: cases.map((c) => c.id) }, side: "APPLICANT", readByStaffAt: null },
    _count: { _all: true },
  });
  const unreadByCase = new Map(unreadRows.map((r) => [r.caseId, r._count._all]));

  // Пачкой закрывается только то, что приходит от незнакомца с улицы, и только
  // тем, кто вправе решать в этой очереди.
  const spamAllowed =
    def.subjectTypes.every(isSpamClosable) && (await myLevel(def.key)) === "APPROVE";

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      <header className="mb-6 text-center">
        <h1 className="text-[26px] font-bold tracking-[-0.03em]">{t(`queues.names.${def.key}`)}</h1>
        <p className="mt-1 text-sm text-muted">{t("queues.subtitle", { count: cases.length })}</p>
      </header>

      {cases.length === 0 ? (
        <div className="rounded-[20px] border border-hairline bg-card p-8 text-center text-muted">
          {t("queues.empty")}
        </div>
      ) : (
        <Wrap allowed={spamAllowed} queue={def.key} ids={cases.map((c) => c.id)}>
          {cases.map((c) => {
            const s = slaState({
              now,
              dueAt: c.dueAt,
              slaSeconds: c.slaSeconds,
              clockStoppedAt: c.clockStoppedAt,
            });
            const d = Math.floor(s.remainingSeconds / 86400);
            const h = Math.floor((s.remainingSeconds % 86400) / 3600);
            return (
              <CaseRowCard
                key={c.id}
                href={`/${locale}/admin/cases/${c.id}`}
                title={c.title}
                statusLabel={t(`case.status.${c.status}`)}
                sla={s.state}
                slaLabel={
                  s.state === "late"
                    ? t("queues.late")
                    : s.state === "paused"
                      ? t("queues.paused")
                      : t("queues.left", { d, h })
                }
                assigneeLabel={c.assignee ? (c.assignee.name ?? c.assignee.username) : null}
                handledLabel={formatHandled(c.handledSeconds, { h: t("case.handledUnits.h"), m: t("case.handledUnits.m") })}
                unreadLabel={
                  unreadByCase.get(c.id)
                    ? t("queues.unread", { count: unreadByCase.get(c.id)! })
                    : null
                }
              />
            );
          })}
        </Wrap>
      )}
    </div>
  );
}

/**
 * Список либо как был, либо с галочками. Обёртка нужна, чтобы строки дел
 * по-прежнему рисовал сервер: клиентская копия карточки разошлась бы с этой.
 */
function Wrap({
  allowed,
  queue,
  ids,
  children,
}: {
  allowed: boolean;
  queue: string;
  ids: string[];
  children: React.ReactNode;
}) {
  if (!allowed) return <div className="flex flex-col gap-3">{children}</div>;
  return (
    <QueueSpamList queue={queue} ids={ids}>
      {children}
    </QueueSpamList>
  );
}
