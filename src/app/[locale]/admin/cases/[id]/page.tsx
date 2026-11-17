import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { AdminNav } from "@/components/admin/nav";
import { CaseSection } from "@/components/admin/case-section";
import { CaseJournal } from "@/components/admin/case-journal";
import { CaseClaim } from "@/components/admin/case-claim";
import { CaseTimer } from "@/components/admin/case-timer";
import { loadSubject } from "@/lib/cases/subject";
import { queueOfSubject } from "@/lib/cases/queues";
import { slaState } from "@/lib/cases/sla";
import { formatHandled } from "@/lib/cases/time";
import { ADMIN_COLUMN, SLA_DOT } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminCasePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const c = await prisma.complianceCase.findUnique({
    where: { id },
    include: {
      assignee: { select: { id: true, name: true, username: true } },
      applicant: { select: { name: true, username: true, email: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { name: true, username: true } } },
      },
    },
  });
  if (!c) notFound();

  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const mine = !!meId && c.assigneeId === meId;

  const subject = await loadSubject(c.subjectType, c.subjectId);
  const now = new Date();
  const s = slaState({
    now,
    dueAt: c.dueAt,
    slaSeconds: c.slaSeconds,
    clockStoppedAt: c.clockStoppedAt,
  });
  const d = Math.floor(s.remainingSeconds / 86400);
  const h = Math.floor((s.remainingSeconds % 86400) / 3600);
  const queueKey = queueOfSubject(c.subjectType)?.key ?? "companies";

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      {mine ? <CaseTimer caseId={c.id} /> : null}

      <header className="mb-5 text-center">
        <div className="num mb-2 text-[10px] uppercase tracking-[0.3em] text-muted">
          {t(`queues.names.${queueKey}`)}
        </div>
        <h1 className="mb-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">{c.title}</h1>
        <div className="flex flex-wrap justify-center gap-1.5">
          <span className="rounded-full bg-card-alt px-2 py-1 text-[10px] font-semibold text-muted-strong">
            {t(`case.status.${c.status}`)}
          </span>
          <span className="rounded-full bg-card-alt px-2 py-1 text-[10px] font-semibold text-muted-strong">
            {t(`case.risk.${c.risk}`)}
          </span>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-[14px] border border-hairline bg-card p-3">
          <div className="mb-1 text-[9.5px] uppercase tracking-[0.18em] text-muted">
            {t("case.due")}
          </div>
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <span className={`block h-1.5 w-1.5 rounded-full ${SLA_DOT[s.state]}`} />
            {s.state === "late" ? t("queues.late") : t("queues.left", { d, h })}
          </div>
        </div>
        <div className="rounded-[14px] border border-hairline bg-card p-3">
          <div className="mb-1 text-[9.5px] uppercase tracking-[0.18em] text-muted">
            {t("case.handled")}
          </div>
          <div className="text-[13px] font-semibold">{formatHandled(c.handledSeconds)}</div>
        </div>
      </div>

      <div className="mb-4">
        <CaseClaim
          caseId={c.id}
          mine={mine}
          taken={!!c.assigneeId}
          claimLabel={t("case.claim")}
          releaseLabel={t("case.release")}
          takenLabel={t("case.takenBy", {
            name: c.assignee?.name ?? c.assignee?.username ?? "—",
          })}
        />
      </div>

      <div className="flex flex-col gap-3 pb-10">
        <CaseSection
          n="1"
          title={t("case.sections.form")}
          summary={t("case.sections.formSummary", { count: subject?.fields.length ?? 0 })}
          open
        >
          {subject ? (
            <dl className="flex flex-col">
              {subject.fields.map((f) => (
                <div
                  key={f.label}
                  className="flex justify-between gap-3 border-b border-hairline py-2 last:border-b-0"
                >
                  <dt className="text-[11px] uppercase tracking-wider text-muted">{f.label}</dt>
                  <dd className="text-right text-[12.5px]">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[12px] text-muted">{t("case.sections.subjectGone")}</p>
          )}
        </CaseSection>

        <CaseSection
          n="2"
          title={t("case.sections.applicant")}
          summary={c.applicant?.email ?? "—"}
        >
          <div className="text-[12.5px]">
            {c.applicant?.name ?? c.applicant?.username ?? "—"}
            <div className="text-[11px] text-muted">{c.applicant?.email ?? "—"}</div>
          </div>
        </CaseSection>

        <CaseSection
          n="3"
          title={t("case.sections.journal")}
          summary={t("case.sections.journalSummary", { count: c.events.length })}
          open
        >
          <CaseJournal
            locale={locale}
            entries={c.events.map((e) => ({
              id: e.id,
              kind: e.kind,
              payload: e.payload,
              createdAt: e.createdAt,
              actorName: e.actor?.name ?? e.actor?.username ?? null,
            }))}
            tr={(key, paramsForKey) => t(key, paramsForKey)}
          />
        </CaseSection>
      </div>
    </div>
  );
}
