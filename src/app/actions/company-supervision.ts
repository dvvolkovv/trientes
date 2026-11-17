"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { appendCaseEvent } from "@/lib/cases/journal";
import { ensureCase } from "@/lib/cases/ensure";
import { sendStaffMessage } from "@/app/actions/case-messages";
import { nextReviewAt } from "@/lib/company-visibility";

export type SupervisionResult = { ok: true } | { ok: false; reason: string };

/** Тот же порог, что у причины отказа: «не применимо» без слов ничего не значит. */
const MIN_REASON = 3;

/**
 * Дело предприятия. У поданной заявки оно уже есть; у предприятия, одобренного
 * до слайса AN, может не быть — заводим идемпотентно, а не отказываем: надзор
 * без нитки переписки был бы монологом.
 */
async function caseOf(company: { id: string; displayName: string; ownerUserId: string }) {
  const key = {
    subjectType_subjectId: { subjectType: "COMPANY" as const, subjectId: company.id },
  };
  const existing = await prisma.complianceCase.findUnique({ where: key });
  if (existing) return existing;
  const id = await ensureCase({
    subjectType: "COMPANY",
    subjectId: company.id,
    title: company.displayName,
    applicantUserId: company.ownerUserId,
  });
  return id ? await prisma.complianceCase.findUnique({ where: { id } }) : null;
}

/**
 * Предупреждение — сообщение в нитку дела плюс событие журнала. Отдельной
 * таблицы нет: журнал неизменяем и уже есть, а колонка-счётчик потребовала бы
 * держать её в согласии с ним руками (тот же довод, что у лестницы жалоб в AQ).
 *
 * Само сообщение пишет `sendStaffMessage`, а не копия его логики: там живут
 * первая отзывчивость, остановка часов и уведомление владельца, и вторая
 * реализация этого разошлась бы через месяц.
 */
export async function warnCompany(input: {
  companyId: string;
  body: string;
}): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const body = input.body.trim();
  if (body.length < MIN_REASON) return { ok: false, reason: "reason_too_short" };

  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };
  const c = await caseOf(company);
  if (!c) return { ok: false, reason: "failed" };

  const sent = await sendStaffMessage({ caseId: c.id, body, needsReply: true });
  if (!sent.ok) return { ok: false, reason: sent.reason };

  await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "COMPANY_WARNED" });
  await logAdminAction({
    actorId: admin.userId,
    action: "WARN_COMPANY",
    targetType: "Company",
    targetId: company.id,
    details: { body: body.slice(0, 500) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Просто написать владельцу, без пометки «предупреждение». */
export async function messageCompany(input: {
  companyId: string;
  body: string;
  needsReply?: boolean;
}): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const body = input.body.trim();
  if (body.length < MIN_REASON) return { ok: false, reason: "reason_too_short" };

  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };
  const c = await caseOf(company);
  if (!c) return { ok: false, reason: "failed" };

  const sent = await sendStaffMessage({
    caseId: c.id,
    body,
    needsReply: input.needsReply !== false,
  });
  if (!sent.ok) return { ok: false, reason: sent.reason };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Снять предприятие с витрины. Статус `APPROVED` не трогаем: это мера надзора,
 * а не отмена решения модератора, и вернуть предприятие должно быть одним
 * действием. Причина обязательна и уходит владельцу словами — иначе он видит
 * исчезнувшие точки и не знает почему.
 */
export async function suspendCompany(input: {
  companyId: string;
  reason: string;
}): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, reason: "reason_too_short" };

  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };

  await prisma.company.update({
    where: { id: company.id },
    data: {
      suspendedAt: new Date(),
      suspendReason: reason.slice(0, 500),
      suspendedById: admin.userId,
    },
  });

  const c = await caseOf(company);
  if (c) {
    // Сбой переписки снятие не отменяет: предприятие уже снято, а причина
    // записана в самой компании.
    const sent = await sendStaffMessage({ caseId: c.id, body: reason, needsReply: true });
    if (!sent.ok) console.error("[company-supervision] message failed", { caseId: c.id, reason: sent.reason });
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "COMPANY_SUSPENDED",
      payload: { reason: reason.slice(0, 200) },
    });
  }

  await logAdminAction({
    actorId: admin.userId,
    action: "SUSPEND_COMPANY",
    targetType: "Company",
    targetId: company.id,
    details: { reason: reason.slice(0, 500) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Вернуть предприятие на витрину — одно действие, без прохода через очередь. */
export async function restoreCompanyListing(input: {
  companyId: string;
}): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };

  await prisma.company.update({
    where: { id: company.id },
    data: { suspendedAt: null, suspendReason: null, suspendedById: null },
  });
  const c = await prisma.complianceCase.findUnique({
    where: { subjectType_subjectId: { subjectType: "COMPANY", subjectId: company.id } },
  });
  if (c) await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "COMPANY_RESTORED" });

  await logAdminAction({
    actorId: admin.userId,
    action: "UNSUSPEND_COMPANY",
    targetType: "Company",
    targetId: company.id,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Пересмотр пройден: событие в журнал и следующая дата. */
export async function passReview(input: { companyId: string }): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };
  const c = await caseOf(company);
  if (!c) return { ok: false, reason: "failed" };

  const now = new Date();
  const due = nextReviewAt(now, c.risk);
  await prisma.complianceCase.update({ where: { id: c.id }, data: { nextReviewAt: due } });
  await appendCaseEvent({
    caseId: c.id,
    actorId: admin.userId,
    kind: "REVIEW_PASSED",
    payload: { next: due.toISOString().slice(0, 10) },
  });
  // Звонок о пересмотре больше не нужен: пересмотр только что прошёл.
  await prisma.adminNotification.deleteMany({ where: { caseId: c.id, kind: "REVIEW_DUE" } });
  await logAdminAction({
    actorId: admin.userId,
    action: "REVIEW_PASSED",
    targetType: "Company",
    targetId: company.id,
    details: { next: due.toISOString().slice(0, 10) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
