"use server";

import { revalidatePath } from "next/cache";
import type { CaseStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { checkAdmin } from "@/lib/is-admin";
import { requireSubject } from "@/lib/authz/guard";
import { caseConflict } from "@/lib/authz/conflict";
import { appendCaseEvent } from "@/lib/cases/journal";
import { pausePatch, resumePatch } from "@/lib/cases/sla";
import { normalizeBody, statusAfterApplicantMessage, statusAfterStaffMessage } from "@/lib/cases/messages";
import { parseAttachments, type Attachment } from "@/lib/cases/attachments";
import { notifyApplicantOfMessage } from "@/lib/cases/notify-applicant";
import { raiseAndNotify } from "@/lib/cases/admin-notify";

export type SendResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unauth" | "forbidden" | "not_found" | "empty" | "too_long" | "conflict_of_interest";
    };

const PREVIEW = 300;

/** Сообщение сотрудника заявителю. */
export async function sendStaffMessage(input: {
  caseId: string;
  body: string;
  attachments?: unknown;
  needsReply?: boolean;
}): Promise<SendResult> {
  // Сначала дело, потом право: по коду отказа не должно быть видно, какие дела
  // существуют. Писать заявителю — уровень «ведёт» в очереди этого дела.
  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, reason: "not_found" };

  const admin = await requireSubject(c.subjectType, "HANDLE");
  if (!admin.ok) return { ok: false, reason: admin.reason === "unauth" ? "unauth" : "forbidden" };

  const conflict = await caseConflict({
    caseId: c.id,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    applicantUserId: c.applicantUserId,
    userId: admin.userId,
  });
  if (conflict) return { ok: false, reason: conflict };

  const files = parseAttachments(input.attachments);
  const text = normalizeBody(input.body, files.length > 0);
  if (!text.ok) return { ok: false, reason: text.reason };

  const now = new Date();
  const needsReply = input.needsReply !== false;

  await prisma.caseMessage.create({
    data: {
      caseId: c.id,
      authorId: admin.userId,
      side: "STAFF",
      body: text.body,
      attachments: files.length ? (files as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  const nextStatus = statusAfterStaffMessage(c.status, needsReply);
  const patch: Prisma.ComplianceCaseUpdateInput = {};
  // Отзывчивость считается один раз и только вперёд: пересчитать её потом нечем.
  if (!c.firstResponseAt) patch.firstResponseAt = now;
  if (nextStatus) {
    patch.status = nextStatus;
    // Часы срока встают: молчание заявителя не должно съедать срок проверяющего.
    Object.assign(patch, pausePatch(now));
  }
  if (Object.keys(patch).length) {
    await prisma.complianceCase.update({ where: { id: c.id }, data: patch });
  }

  await appendCaseEvent({
    caseId: c.id,
    actorId: admin.userId,
    kind: "MESSAGE_SENT",
    payload: { preview: text.body.slice(0, 120), files: files.length },
  });
  if (nextStatus) {
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "STATUS_CHANGED",
      payload: { from: c.status, to: nextStatus },
    });
    await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "CLOCK_PAUSED" });
  }

  if (c.applicantUserId) {
    void notifyApplicantOfMessage({
      applicantUserId: c.applicantUserId,
      caseId: c.id,
      caseTitle: c.title,
      preview: text.body.slice(0, PREVIEW),
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Ответ заявителя. Права — только сам заявитель этого дела. */
export async function sendApplicantMessage(input: {
  caseId: string;
  body: string;
  attachments?: unknown;
}): Promise<SendResult> {
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!me) return { ok: false, reason: "unauth" };

  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, reason: "not_found" };
  if (c.applicantUserId !== me) return { ok: false, reason: "forbidden" };

  const files = parseAttachments(input.attachments);
  const text = normalizeBody(input.body, files.length > 0);
  if (!text.ok) return { ok: false, reason: text.reason };

  const now = new Date();
  await prisma.caseMessage.create({
    data: {
      caseId: c.id,
      authorId: me,
      side: "APPLICANT",
      body: text.body,
      attachments: files.length ? (files as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  const nextStatus: CaseStatus | null = statusAfterApplicantMessage(c.status);
  if (nextStatus) {
    // Часы идут снова, и dueAt сдвигается ровно на простой.
    const resumed = resumePatch({ dueAt: c.dueAt, clockStoppedAt: c.clockStoppedAt, now });
    await prisma.complianceCase.update({
      where: { id: c.id },
      data: { status: nextStatus, ...resumed },
    });
  }

  await appendCaseEvent({
    caseId: c.id,
    actorId: me,
    actorSide: "APPLICANT",
    kind: "MESSAGE_RECEIVED",
    payload: { preview: text.body.slice(0, 120), files: files.length },
  });
  if (nextStatus) {
    await appendCaseEvent({
      caseId: c.id,
      actorId: me,
      actorSide: "APPLICANT",
      kind: "STATUS_CHANGED",
      payload: { from: c.status, to: nextStatus },
    });
    await appendCaseEvent({ caseId: c.id, actorId: me, actorSide: "APPLICANT", kind: "CLOCK_RESUMED" });
  }

  // Звоним только взявшему дело: иначе каждый ответ будил бы всех админов.
  if (c.assigneeId) {
    void raiseAndNotify({
      userId: c.assigneeId,
      kind: "APPLICANT_REPLIED",
      caseId: c.id,
      title: c.title,
      body: text.body.slice(0, PREVIEW),
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Отметка о прочтении. Сторона определяется по тому, кто спрашивает: заявитель
 * гасит наши сообщения, сотрудник — сообщения заявителя (по стороне, а не по
 * человеку: это общий стол заявок).
 *
 * Без revalidatePath — вызов идёт из эффекта при открытии нитки, а счётчики
 * страницы всё равно пересчитываются при следующем переходе (все экраны
 * админки — force-dynamic).
 */
export async function markCaseRead(input: { caseId: string }): Promise<{ ok: boolean }> {
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!me) return { ok: false };

  const c = await prisma.complianceCase.findUnique({
    where: { id: input.caseId },
    select: { applicantUserId: true, subjectType: true },
  });
  if (!c) return { ok: false };
  const now = new Date();

  if (c.applicantUserId === me) {
    await prisma.caseMessage.updateMany({
      where: { caseId: input.caseId, side: "STAFF", readByApplicantAt: null },
      data: { readByApplicantAt: now },
    });
    return { ok: true };
  }

  // Непрочитанное гасится по стороне, а не по человеку, поэтому гасить его
  // вправе только тот, кому эта очередь видна.
  const admin = await requireSubject(c.subjectType, "VIEW");
  if (!admin.ok) return { ok: false };
  await prisma.caseMessage.updateMany({
    where: { caseId: input.caseId, side: "APPLICANT", readByStaffAt: null },
    data: { readByStaffAt: now },
  });
  // Колокольчик про ответ гаснет вместе с ниткой: прочитано — значит прочитано.
  await prisma.adminNotification.updateMany({
    where: { userId: admin.userId, caseId: input.caseId, kind: "APPLICANT_REPLIED", readAt: null },
    data: { readAt: now },
  });
  return { ok: true };
}

/** Гашение всех моих колокольчиков — зовётся при открытии списка уведомлений. */
export async function markNotificationsRead(): Promise<{ ok: boolean }> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false };
  await prisma.adminNotification.updateMany({
    where: { userId: admin.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export type { Attachment };
