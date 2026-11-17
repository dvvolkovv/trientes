import type { CaseRisk, CaseSubjectType, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeDue } from "./sla";

export type EnsureCaseInput = {
  subjectType: CaseSubjectType;
  subjectId: string;
  title: string;
  applicantUserId: string | null;
  risk?: CaseRisk;
  openedAt?: Date;
};

/**
 * Идемпотентно: у объекта ровно одно дело (@@unique([subjectType, subjectId])).
 * Параллельная подача ловится P2002 и читает чужое дело, а не падает.
 */
export async function ensureCaseCore(
  db: Pick<PrismaClient, "complianceCase" | "caseEvent">,
  input: EnsureCaseInput,
): Promise<string> {
  const key = {
    subjectType_subjectId: { subjectType: input.subjectType, subjectId: input.subjectId },
  };
  const existing = await db.complianceCase.findUnique({ where: key });
  if (existing) return existing.id;

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
export async function ensureCase(input: EnsureCaseInput): Promise<string | null> {
  try {
    return await ensureCaseCore(prisma, input);
  } catch (err) {
    console.error(`[cases] failed to open case for ${input.subjectType}:${input.subjectId}`, err);
    return null;
  }
}
