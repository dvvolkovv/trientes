"use server";

import { revalidatePath } from "next/cache";
import type { CaseCheckState, CaseDocumentVerdict } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { appendCaseEvent } from "@/lib/cases/journal";
import { nextReviewAt } from "@/lib/company-visibility";
import { checklistFor, checklistProgress, noteRequired } from "@/lib/cases/checklists";
import { approvalBlockers, isSoleSignOff, rejectBlockers } from "@/lib/cases/approval";
import { applyDecision, isAlreadySettled } from "@/lib/cases/decide";
import { closePatch } from "@/lib/cases/time";
import { isOpen } from "@/lib/cases/types";

const NOTE_MIN = 3;

/** Отметка по пункту листа проверок. Пункт должен быть из листа своего типа. */
export async function setCaseCheck(input: {
  caseId: string;
  key: string;
  state: CaseCheckState;
  note?: string;
}) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };

  const c = await prisma.complianceCase.findUnique({
    where: { id: input.caseId },
    select: { id: true, subjectType: true, status: true },
  });
  if (!c) return { ok: false as const, reason: "not_found" as const };
  if (!isOpen(c.status)) return { ok: false as const, reason: "case_closed" as const };
  if (!checklistFor(c.subjectType).some((d) => d.key === input.key)) {
    return { ok: false as const, reason: "unknown_check" as const };
  }

  const note = (input.note ?? "").trim();
  if (noteRequired(input.state) && note.length < NOTE_MIN) {
    return { ok: false as const, reason: "note_required" as const };
  }

  const now = new Date();
  await prisma.caseCheck.upsert({
    where: { caseId_key: { caseId: c.id, key: input.key } },
    create: {
      caseId: c.id,
      key: input.key,
      state: input.state,
      checkedById: admin.userId,
      checkedAt: now,
      note: note || null,
    },
    update: { state: input.state, checkedById: admin.userId, checkedAt: now, note: note || null },
  });
  await appendCaseEvent({
    caseId: c.id,
    actorId: admin.userId,
    kind: "CHECK_SET",
    payload: { key: input.key, state: input.state, ...(note ? { note } : {}) },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Вердикт по документу. «Переслать заново» и «отклонён» требуют причины. */
export async function setDocumentVerdict(input: {
  documentId: string;
  verdict: CaseDocumentVerdict;
  note?: string;
}) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };

  const doc = await prisma.caseDocument.findUnique({
    where: { id: input.documentId },
    select: { id: true, caseId: true, label: true, kind: true },
  });
  if (!doc) return { ok: false as const, reason: "not_found" as const };

  const note = (input.note ?? "").trim();
  if ((input.verdict === "REJECTED" || input.verdict === "RESUBMIT") && note.length < NOTE_MIN) {
    return { ok: false as const, reason: "note_required" as const };
  }

  await prisma.caseDocument.update({
    where: { id: doc.id },
    data: {
      verdict: input.verdict,
      verdictById: admin.userId,
      verdictAt: new Date(),
      verdictNote: note || null,
    },
  });
  await appendCaseEvent({
    caseId: doc.caseId,
    actorId: admin.userId,
    kind: "DOCUMENT_VERDICT",
    payload: { label: doc.label ?? doc.kind, verdict: input.verdict, ...(note ? { note } : {}) },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Первая подпись. Ставить её можно, только когда по всем обязательным пунктам
 * дан ответ и ни по одному документу не ждём новой присылки — иначе слово
 * «проверил» ничего не значило бы.
 */
export async function markReviewed(input: { caseId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };

  const c = await prisma.complianceCase.findUnique({
    where: { id: input.caseId },
    include: { checks: { select: { key: true, state: true } } },
  });
  if (!c) return { ok: false as const, reason: "not_found" as const };
  if (!isOpen(c.status)) return { ok: false as const, reason: "case_closed" as const };

  const progress = checklistProgress(c.subjectType, c.checks);
  if (progress.requiredPending > 0) return { ok: false as const, reason: "checks_pending" as const };
  const resubmit = await prisma.caseDocument.count({
    where: { caseId: c.id, verdict: "RESUBMIT" },
  });
  if (resubmit > 0) return { ok: false as const, reason: "documents_resubmit" as const };

  await prisma.complianceCase.update({
    where: { id: c.id },
    data: { reviewedById: admin.userId, reviewedAt: new Date(), status: "READY_FOR_APPROVAL" },
  });
  await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "REVIEWED" });
  if (c.status !== "READY_FOR_APPROVAL") {
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "STATUS_CHANGED",
      payload: { from: c.status, to: "READY_FOR_APPROVAL" },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Решение по делу. Одобрение — вторая подпись и проверка препятствий; отказ
 * второй подписи не требует, но требует причины.
 *
 * Порядок важен: сначала меняется сам объект заявки, и только потом дело. Если
 * объект уже решён вне дела, дело закрывается как CLOSED — иначе оно висело бы
 * в очереди навсегда.
 */
export async function decideCase(input: {
  caseId: string;
  decision: "APPROVED" | "REJECTED";
  reason?: string;
}) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };

  const c = await prisma.complianceCase.findUnique({
    where: { id: input.caseId },
    include: { checks: { select: { key: true, state: true } } },
  });
  if (!c) return { ok: false as const, reason: "not_found" as const };
  if (!isOpen(c.status)) return { ok: false as const, reason: "case_closed" as const };

  const reason = (input.reason ?? "").trim();
  let sole = false;

  if (input.decision === "APPROVED") {
    const progress = checklistProgress(c.subjectType, c.checks);
    const resubmit = await prisma.caseDocument.count({
      where: { caseId: c.id, verdict: "RESUBMIT" },
    });
    const otherApproversCount = await prisma.user.count({
      where: { role: "ADMIN", id: { not: c.reviewedById ?? admin.userId } },
    });
    const gate = {
      requiredPending: progress.requiredPending,
      resubmitDocs: resubmit,
      reviewedById: c.reviewedById,
      meId: admin.userId,
      otherApproversCount,
    };
    const blockers = approvalBlockers(gate);
    if (blockers.length > 0) return { ok: false as const, reason: blockers[0] };
    sole = isSoleSignOff(gate);
  } else {
    const bad = rejectBlockers(reason);
    if (bad.length > 0) return { ok: false as const, reason: bad[0] };
  }

  const applied = await applyDecision({
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    decision: input.decision,
    reason,
  });

  const now = new Date();
  if (!applied.ok && !isAlreadySettled(applied.reason)) {
    return { ok: false as const, reason: applied.reason };
  }

  if (!applied.ok) {
    // Объект решён вне дела или исчез: дело закрываем, решение не присваиваем.
    await prisma.complianceCase.update({
      where: { id: c.id },
      data: { status: "CLOSED", decidedAt: now, clockStoppedAt: null },
    });
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "STATUS_CHANGED",
      payload: { from: c.status, to: "CLOSED", why: applied.reason },
    });
    revalidatePath("/", "layout");
    return { ok: true as const, closedWithoutDecision: true as const };
  }

  await closeOpenEntries(c.id, admin.userId);
  await prisma.complianceCase.update({
    where: { id: c.id },
    data: {
      status: input.decision,
      decision: input.decision,
      decisionReason: reason || null,
      decidedAt: now,
      clockStoppedAt: null,
      soleSignOff: sole,
      ...(input.decision === "APPROVED" ? { approvedById: admin.userId, approvedAt: now } : {}),
      // Залистованное предприятие пересматривают периодически: срок ставится
      // здесь, в момент листинга, а не отдельным делом — у дела @@unique на
      // объект, второго дела у той же компании быть не может.
      ...(input.decision === "APPROVED" && c.subjectType === "COMPANY"
        ? { nextReviewAt: nextReviewAt(now, c.risk) }
        : {}),
    },
  });
  await appendCaseEvent({
    caseId: c.id,
    actorId: admin.userId,
    kind: "DECIDED",
    payload: { decision: input.decision, ...(reason ? { reason } : {}), ...(sole ? { sole: 1 } : {}) },
  });
  await recomputeHandled(c.id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

async function closeOpenEntries(caseId: string, userId: string) {
  const open = await prisma.caseTimeEntry.findMany({ where: { caseId, userId, endedAt: null } });
  for (const e of open) {
    await prisma.caseTimeEntry.update({
      where: { id: e.id },
      data: closePatch({ startedAt: e.startedAt, lastBeatAt: e.lastBeatAt }),
    });
  }
}

async function recomputeHandled(caseId: string) {
  const agg = await prisma.caseTimeEntry.aggregate({ where: { caseId }, _sum: { seconds: true } });
  await prisma.complianceCase.update({
    where: { id: caseId },
    data: { handledSeconds: agg._sum.seconds ?? 0 },
  });
}
