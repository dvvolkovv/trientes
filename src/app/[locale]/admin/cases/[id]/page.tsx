import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { mySubjectLevel, requireSubject } from "@/lib/authz/guard";
import { caseConflict } from "@/lib/authz/conflict";
import { countOtherApprovers } from "@/lib/cases/approvers";
import { auth } from "@/auth";
import { AdminNav } from "@/components/admin/nav";
import { CaseSection } from "@/components/admin/case-section";
import { CaseJournal } from "@/components/admin/case-journal";
import { CaseClaim } from "@/components/admin/case-claim";
import { CaseTimer } from "@/components/admin/case-timer";
import { CaseChecklist, type ChecklistItem } from "@/components/admin/case-checklist";
import { CaseDocuments, type CaseDocumentItem } from "@/components/admin/case-documents";
import { CaseDecision } from "@/components/admin/case-decision";
import { CaseReports } from "@/components/admin/case-reports";
import { CaseThread } from "@/components/cases/case-thread";
import { CaseComposer } from "@/components/cases/case-composer";
import { CaseReadMarker } from "@/components/cases/case-read-marker";
import { loadSubject } from "@/lib/cases/subject";
import { parseAttachments } from "@/lib/cases/attachments";
import { TEMPLATE_KEYS, unreadCount } from "@/lib/cases/messages";
import { checklistFor, checklistProgress } from "@/lib/cases/checklists";
import { approvalBlockers, isSoleSignOff } from "@/lib/cases/approval";
import { syncCaseDocuments } from "@/lib/cases/documents";
import { pickLocale } from "@/lib/locales";
import { queueOfSubject } from "@/lib/cases/queues";
import { slaState } from "@/lib/cases/sla";
import { formatHandled } from "@/lib/cases/time";
import { isOpen } from "@/lib/cases/types";
import { ADMIN_BUTTON_SECONDARY, ADMIN_COLUMN, SLA_DOT } from "@/lib/admin-ui";

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
      reviewer: { select: { id: true, name: true, username: true } },
      approver: { select: { id: true, name: true, username: true } },
      applicant: { select: { name: true, username: true, email: true, preferredLocale: true } },
      checks: { include: { checkedBy: { select: { name: true, username: true } } } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true, username: true } } },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { name: true, username: true } } },
      },
    },
  });
  if (!c) notFound();
  if (!(await requireSubject(c.subjectType, "VIEW")).ok) notFound();

  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const mine = !!meId && c.assigneeId === meId;

  // Кнопки рисуются по уровню: смотрящий не должен видеть «взять дело», а
  // ведущий — «одобрить». Серверная проверка остаётся на месте: скрытая кнопка
  // не защита.
  const level = await mySubjectLevel(c.subjectType);
  const canHandle = level === "HANDLE" || level === "APPROVE";
  const canDecide = level === "APPROVE";
  const conflict = meId
    ? await caseConflict({
        caseId: c.id,
        subjectType: c.subjectType,
        subjectId: c.subjectId,
        applicantUserId: c.applicantUserId,
        userId: meId,
      })
    : null;
  const mayWork = canHandle && !conflict;

  // Документы собираются из уже существующих источников (анкета KYB и вложения
  // заявителя), а не загружаются в деле заново.
  await syncCaseDocuments({ caseId: c.id, subjectType: c.subjectType, subjectId: c.subjectId });
  const documents = await prisma.caseDocument.findMany({
    where: { caseId: c.id },
    orderBy: { createdAt: "asc" },
  });

  const subject = await loadSubject(c.subjectType, c.subjectId);

  // Жалобы читаются только у своего типа дела: остальным это лишний запрос.
  const reports =
    c.subjectType === "POINT_REPORT"
      ? await prisma.pointReport.findMany({
          where: { pointId: c.subjectId },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { reporter: { select: { name: true, username: true } } },
        })
      : [];
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

  const unread = unreadCount(
    c.messages.map((m) => ({
      side: m.side,
      readByStaffAt: m.readByStaffAt,
      readByApplicantAt: m.readByApplicantAt,
    })),
    "STAFF",
  );

  // --- Лист проверок -------------------------------------------------------
  const checkByKey = new Map(c.checks.map((row) => [row.key, row]));
  const checklist: ChecklistItem[] = checklistFor(c.subjectType).map((def) => {
    const row = checkByKey.get(def.key);
    return {
      key: def.key,
      label: t(`case.checks.${def.key}`),
      required: def.required,
      state: row?.state ?? "TODO",
      note: row?.note ?? null,
      checkedByName: row?.checkedBy?.name ?? row?.checkedBy?.username ?? null,
    };
  });
  const progress = checklistProgress(
    c.subjectType,
    c.checks.map((row) => ({ key: row.key, state: row.state })),
  );

  // --- Документы -----------------------------------------------------------
  const docItems: CaseDocumentItem[] = documents.map((doc) => ({
    id: doc.id,
    kindLabel: t(`case.docs.kinds.${doc.kind}`),
    label: doc.label ?? t(`case.docs.kinds.${doc.kind}`),
    url: doc.url,
    verdict: doc.verdict,
    note: doc.verdictNote,
  }));
  const resubmitDocs = documents.filter((doc) => doc.verdict === "RESUBMIT").length;
  const judgedDocs = documents.filter((doc) => doc.verdict !== "PENDING").length;

  // --- Подписи -------------------------------------------------------------
  const otherApproversCount = await countOtherApprovers(
    c.subjectType,
    c.reviewedById ?? meId ?? "",
  );
  const gate = {
    requiredPending: progress.requiredPending,
    resubmitDocs,
    reviewedById: c.reviewedById,
    meId: meId ?? "",
    otherApproversCount,
  };
  const approveBlocks = approvalBlockers(gate);
  const reviewBlocks = [
    ...(progress.requiredPending > 0 ? ["checks_pending"] : []),
    ...(resubmitDocs > 0 ? ["documents_resubmit"] : []),
  ];

  // Заготовки — на языке кабинета заявителя: читать их будет он.
  const applicantLocale = pickLocale(c.applicant?.preferredLocale);
  const tpl = await getTranslations({ locale: applicantLocale, namespace: "admin.case.templates" });
  const templates = TEMPLATE_KEYS.map((key) => ({
    key,
    label: t(`case.thread.templateLabels.${key}`),
    text: tpl(key),
  }));

  const threadLabels = {
    placeholder: t("case.thread.placeholder"),
    send: t("case.thread.send"),
    needsReply: t("case.thread.needsReply"),
    templates: t("case.thread.templates"),
    attach: t("case.thread.attach"),
    attaching: t("case.thread.attaching"),
    // .raw — потому что {count} подставит клиент, когда файл уже приложен.
    attached: t.raw("case.thread.attached") as string,
    errors: {
      empty: t("case.thread.errors.empty"),
      too_long: t("case.thread.errors.too_long"),
      too_large: t("case.thread.errors.too_large"),
      bad_type: t("case.thread.errors.bad_type"),
      failed: t("case.thread.errors.failed"),
      forbidden: t("case.thread.errors.failed"),
      unauth: t("case.thread.errors.failed"),
      not_found: t("case.thread.errors.failed"),
    },
  };

  const reviewerName = c.reviewer?.name ?? c.reviewer?.username ?? null;
  const approverName = c.approver?.name ?? c.approver?.username ?? null;

  // Журнал получает уже переведённые ключ пункта и состояние: сырой enum в
  // рассказе о работе по делу читать невозможно.
  const journalEntries = c.events.map((e) => {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const patched: Record<string, unknown> = { ...payload };
    if (e.kind === "CHECK_SET") {
      if (typeof payload.key === "string") patched.key = t(`case.checks.${payload.key}`);
      if (typeof payload.state === "string") {
        patched.state = t(`case.checklist.state.${payload.state}`);
      }
    }
    if (e.kind === "DOCUMENT_VERDICT" && typeof payload.verdict === "string") {
      patched.verdict = t(`case.docs.verdict.${payload.verdict}`);
    }
    return {
      id: e.id,
      kind: e.kind,
      payload: patched,
      createdAt: e.createdAt,
      actorName: e.actor?.name ?? e.actor?.username ?? null,
    };
  });

  // Номер раздела считается, а не вписан руками: раздел «Жалобы» появляется
  // только у дел по жалобам, и вписанные номера разъехались бы.
  // У дела по жалобе «одобрить» значит «подтвердить жалобу»: подписи кнопок
  // свои, иначе это читается как «одобрить точку».
  const decisionLabels =
    c.subjectType === "POINT_REPORT"
      ? {
          approve: t("case.decision.pointReport.approve"),
          reject: t("case.decision.pointReport.reject"),
        }
      : { approve: t("case.decision.approve"), reject: t("case.decision.reject") };

  let sectionNo = 0;
  const nextNo = () => String(++sectionNo);

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
          <div className="text-[13px] font-semibold">{formatHandled(c.handledSeconds, { h: t("case.handledUnits.h"), m: t("case.handledUnits.m") })}</div>
        </div>
      </div>

      {mayWork ? (
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
      ) : (
        <p className="mb-4 text-[12px] text-muted">
          {conflict ? t("case.access.conflict") : t("case.access.readOnly")}
        </p>
      )}

      {c.subjectType === "COMPANY" || c.subjectType === "KYB" ? (
        <div className="mb-4">
          <a
            href={`/${locale}/admin/companies/${c.subjectId}`}
            className={ADMIN_BUTTON_SECONDARY}
          >
            {t("company.openSupervision")}
          </a>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 pb-10">
        <CaseSection
          n={nextNo()}
          title={t("case.sections.form")}
          summary={t("case.sections.formSummary", { count: subject?.fields.length ?? 0 })}
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
          n={nextNo()}
          title={t("case.sections.applicant")}
          summary={c.applicant?.email ?? "—"}
        >
          <div className="text-[12.5px]">
            {c.applicant?.name ?? c.applicant?.username ?? "—"}
            <div className="text-[11px] text-muted">{c.applicant?.email ?? "—"}</div>
          </div>
        </CaseSection>

        {c.subjectType === "POINT_REPORT" && (
          <CaseSection
            n={nextNo()}
            title={t("case.reports.title")}
            summary={t("case.reports.summary", { count: reports.length })}
            open
          >
            <CaseReports
              emptyLabel={t("case.reports.empty")}
              items={reports.map((r) => ({
                id: r.id,
                reasonLabel: t(`case.reports.reason.${r.reason}`),
                comment: r.comment,
                who: r.reporter?.name ?? r.reporter?.username ?? t("case.reports.anonymous"),
                createdAt: r.createdAt,
              }))}
            />
          </CaseSection>
        )}

        <CaseSection
          n={nextNo()}
          title={t("case.checklist.title")}
          summary={
            progress.requiredPending > 0
              ? `${t("case.checklist.summary", { answered: progress.answered, total: progress.total })} · ${t("case.checklist.requiredLeft", { count: progress.requiredPending })}`
              : `${t("case.checklist.summary", { answered: progress.answered, total: progress.total })} · ${t("case.checklist.allAnswered")}`
          }
          open={isOpen(c.status)}
        >
          <CaseChecklist
            caseId={c.id}
            readOnly={!mayWork}
            items={checklist}
            labels={{
              required: t("case.checklist.required"),
              hint: t("case.checklist.hint"),
              state: {
                TODO: t("case.checklist.state.TODO"),
                OK: t("case.checklist.state.OK"),
                FAIL: t("case.checklist.state.FAIL"),
                NA: t("case.checklist.state.NA"),
              },
              set: {
                OK: t("case.checklist.set.OK"),
                FAIL: t("case.checklist.set.FAIL"),
                NA: t("case.checklist.set.NA"),
              },
              notePlaceholder: t("case.checklist.notePlaceholder"),
              errors: {
                note_required: t("case.checklist.errors.note_required"),
                unknown_check: t("case.checklist.errors.unknown_check"),
                case_closed: t("case.checklist.errors.case_closed"),
                failed: t("case.checklist.errors.failed"),
                unauth: t("case.checklist.errors.failed"),
                no_access: t("case.checklist.errors.failed"),
                not_found: t("case.checklist.errors.failed"),
              },
            }}
          />
        </CaseSection>

        <CaseSection
          n={nextNo()}
          title={t("case.docs.title")}
          summary={t("case.docs.summary", { judged: judgedDocs, total: documents.length })}
        >
          <CaseDocuments
            docs={docItems}
            emptyLabel={t("case.docs.empty")}
            labels={{
              verdict: {
                PENDING: t("case.docs.verdict.PENDING"),
                ACCEPTED: t("case.docs.verdict.ACCEPTED"),
                REJECTED: t("case.docs.verdict.REJECTED"),
                RESUBMIT: t("case.docs.verdict.RESUBMIT"),
              },
              set: {
                ACCEPTED: t("case.docs.set.ACCEPTED"),
                REJECTED: t("case.docs.set.REJECTED"),
                RESUBMIT: t("case.docs.set.RESUBMIT"),
              },
              notePlaceholder: t("case.docs.notePlaceholder"),
              open: t("case.docs.open"),
              errors: {
                note_required: t("case.docs.errors.note_required"),
                failed: t("case.docs.errors.failed"),
                unauth: t("case.docs.errors.failed"),
                no_access: t("case.docs.errors.failed"),
                not_found: t("case.docs.errors.failed"),
              },
            }}
          />
        </CaseSection>

        <CaseSection
          n={nextNo()}
          title={t("case.thread.title")}
          summary={
            unread > 0
              ? t("case.thread.unreadSummary", { count: c.messages.length, unread })
              : t("case.thread.summary", { count: c.messages.length })
          }
          open
        >
          {unread > 0 ? <CaseReadMarker caseId={c.id} /> : null}
          <CaseThread
            caseId={c.id}
            locale={locale}
            mySide="STAFF"
            messages={c.messages.map((m) => ({
              id: m.id,
              side: m.side,
              body: m.body,
              attachments: parseAttachments(m.attachments),
              createdAt: m.createdAt,
              authorName: m.author?.name ?? m.author?.username ?? null,
            }))}
            staffLabel={t("case.thread.staff")}
            applicantLabel={t("case.thread.applicant")}
            emptyLabel={t("case.thread.empty")}
          />
          {!c.applicantUserId ? (
            <p className="mt-3 text-[12px] text-muted">{t("case.thread.noApplicant")}</p>
          ) : mayWork ? (
            <CaseComposer caseId={c.id} side="STAFF" templates={templates} labels={threadLabels} />
          ) : (
            <p className="mt-3 text-[12px] text-muted">
              {conflict ? t("case.access.conflict") : t("case.access.readOnly")}
            </p>
          )}
        </CaseSection>

        <CaseSection
          n={nextNo()}
          title={t("case.decision.title")}
          summary={
            c.decision
              ? t("case.decision.summaryDecided", { decision: t(`case.status.${c.decision}`) })
              : !isOpen(c.status)
                ? // Закрыто без решения: объект решили вне дела. Писать тут
                  // «ждём вторую подпись» было бы неправдой.
                  t("case.decision.summaryClosed")
                : c.reviewedById
                  ? t("case.decision.summaryReviewed")
                  : t("case.decision.summary")
          }
          open={isOpen(c.status)}
        >
          {isOpen(c.status) && mayWork ? (
            <CaseDecision
              caseId={c.id}
              reviewedByName={reviewerName}
              approveBlockers={approveBlocks}
              reviewBlockers={reviewBlocks}
              wouldBeSole={isSoleSignOff(gate)}
              canDecide={canDecide}
              labels={{
                review: t("case.decision.review"),
                reviewedBy: t.raw("case.decision.reviewedBy") as string,
                approve: decisionLabels.approve,
                reject: decisionLabels.reject,
                reasonPlaceholder: t("case.decision.reasonPlaceholder"),
                soleHint: t("case.decision.soleHint"),
                rejectHint: t("case.decision.rejectHint"),
                closedWithoutDecision: t("case.decision.closedWithoutDecision"),
                noDecideRight: t("case.decision.noDecideRight"),
                blockers: {
                  checks_pending: t("case.decision.blockers.checks_pending"),
                  documents_resubmit: t("case.decision.blockers.documents_resubmit"),
                  not_reviewed: t("case.decision.blockers.not_reviewed"),
                  same_person: t("case.decision.blockers.same_person"),
                },
                errors: {
                  reason_too_short: t("case.decision.errors.reason_too_short"),
                  case_closed: t("case.decision.errors.case_closed"),
                  not_found: t("case.decision.errors.not_found"),
                  not_pending: t("case.decision.errors.not_pending"),
                  // Отказ самого объекта: заявка не готова к публикации. Живой
                  // прогон 18.11 показал его как «не удалось сохранить» —
                  // проверяющий нажимал кнопку снова, а дело было в заявке.
                  too_incomplete: t("case.decision.errors.too_incomplete"),
                  logo_required: t("case.decision.errors.logo_required"),
                  slug_taken: t("case.decision.errors.slug_taken"),
                  already_verified: t("case.decision.errors.already_verified"),
                  invalid: t("case.decision.errors.invalid"),
                  failed: t("case.decision.errors.failed"),
                  unauth: t("case.decision.errors.failed"),
                  no_access: t("case.decision.errors.failed"),
                  forbidden: t("case.decision.errors.failed"),
                },
              }}
            />
          ) : (
            <div className="flex flex-col gap-1.5 text-[12.5px]">
              {reviewerName ? (
                <div className="text-muted">{t("case.decision.reviewedBy", { name: reviewerName })}</div>
              ) : null}
              {approverName ? (
                <div className="text-muted">{t("case.decision.approvedBy", { name: approverName })}</div>
              ) : null}
              {c.soleSignOff ? <div className="text-[#e2a33c]">{t("case.decision.sole")}</div> : null}
              {c.decisionReason ? <p className="leading-snug">{c.decisionReason}</p> : null}
            </div>
          )}
        </CaseSection>

        <CaseSection
          n={nextNo()}
          title={t("case.sections.journal")}
          summary={t("case.sections.journalSummary", { count: c.events.length })}
        >
          <CaseJournal
            locale={locale}
            entries={journalEntries}
            tr={(key, paramsForKey) => t(key, paramsForKey)}
          />
        </CaseSection>
      </div>
    </div>
  );
}
