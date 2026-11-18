import type { CaseRisk, CaseSubjectType, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeDue } from "./sla";
import { reopenPatch } from "./reopen";
import { isOpen } from "./types";

export type EnsureCaseInput = {
  subjectType: CaseSubjectType;
  subjectId: string;
  title: string;
  applicantUserId: string | null;
  risk?: CaseRisk;
  openedAt?: Date;
};

export type EnsureDb = Pick<
  PrismaClient,
  "complianceCase" | "caseEvent" | "caseCheck" | "caseDocument"
>;

/**
 * Идемпотентно: у объекта ровно одно дело (@@unique([subjectType, subjectId])).
 * Параллельная подача ловится P2002 и читает чужое дело, а не падает.
 *
 * Дело, по которому решение уже принято, при повторной подаче **открывается
 * заново**: объект снова ждёт решения, и очередь обязана это показать.
 * Открытое дело не трогается вовсе — вызов на живом деле должен остаться
 * пустым действием.
 */
export async function ensureCaseCore(
  db: EnsureDb,
  input: EnsureCaseInput,
): Promise<string> {
  const key = {
    subjectType_subjectId: { subjectType: input.subjectType, subjectId: input.subjectId },
  };
  const existing = await db.complianceCase.findUnique({ where: key });
  if (existing) {
    if (isOpen(existing.status)) return existing.id;
    await reopen(db, existing.id, input.subjectType, input.openedAt ?? new Date());
    return existing.id;
  }

  const openedAt = input.openedAt ?? new Date();
  const { dueAt, slaSeconds } = computeDue(openedAt, input.subjectType);
  try {
    const created = await db.complianceCase.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        title: input.title.slice(0, 200),
        applicantUserId: input.applicantUserId,
        risk: input.risk ?? "MEDIUM",
        status: "NEW",
        openedAt,
        dueAt,
        slaSeconds,
      },
    });
    await db.caseEvent.create({
      data: {
        caseId: created.id,
        actorSide: "SYSTEM",
        kind: "OPENED",
        payload: { title: input.title.slice(0, 200) },
      },
    });
    return created.id;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const other = await db.complianceCase.findUnique({ where: key });
      if (other) return other.id;
    }
    throw err;
  }
}

/**
 * Обёртка для мест подачи заявки. Сбой заведения дела не должен ронять саму
 * подачу — заявка человека дороже строки в очереди; осиротевшую заявку
 * подберёт `scripts/backfill-cases.ts` (он идемпотентен и ходит по PENDING).
 */
async function reopen(
  db: EnsureDb,
  caseId: string,
  subjectType: CaseSubjectType,
  now: Date,
): Promise<void> {
  await db.complianceCase.update({ where: { id: caseId }, data: reopenPatch(now, subjectType) });
  // Ответы листа проверок относились к прежней версии объекта: оставь их — и
  // одобрение прошло бы без единого живого взгляда. Из истории они не
  // исчезают: каждый лежит в журнале событием CHECK_SET, а журнал неизменяем.
  await db.caseCheck.deleteMany({ where: { caseId } });
  // «Переслать заново» снимается: присылка и есть ответ на эту просьбу, а не
  // снятый вердикт блокировал бы одобрение навсегда. Прочие вердикты относятся
  // к конкретному файлу и остаются в силе.
  await db.caseDocument.updateMany({
    where: { caseId, verdict: "RESUBMIT" },
    data: { verdict: "PENDING", verdictById: null, verdictAt: null, verdictNote: null },
  });
  await db.caseEvent.create({
    data: {
      caseId,
      actorSide: "SYSTEM",
      kind: "REOPENED",
      payload: { why: "resubmitted" },
    },
  });
}

export async function ensureCase(input: EnsureCaseInput): Promise<string | null> {
  try {
    return await ensureCaseCore(prisma, input);
  } catch (err) {
    console.error(`[cases] failed to open case for ${input.subjectType}:${input.subjectId}`, err);
    return null;
  }
}
