import { prisma } from "@/lib/prisma";
import { appendCaseEvent } from "./journal";
import { ensureCaseCore } from "./ensure";
import { computeDue } from "./sla";

export type CompanyCaseRow = {
  id: string;
  displayName: string;
  ownerUserId: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
};

/**
 * Дело предприятия, заведённое задним числом.
 *
 * Заводится **уже решённым** (`status: APPROVED`), но **без решения**
 * (`decision: null`): решение принималось на старом экране, а не здесь, и
 * записать его сюда значило бы приписать сотруднику работу, которой в деле не
 * было — аналитика считает именно `decision != null`. Открытым его заводить
 * нельзя тем более: дело залистованного год назад предприятия повисло бы в
 * очереди с просроченным сроком.
 */
async function openSettledCase(company: CompanyCaseRow): Promise<string | null> {
  const openedAt = company.reviewedAt ?? company.createdAt;
  const { dueAt, slaSeconds } = computeDue(openedAt, "COMPANY");
  try {
    const created = await prisma.complianceCase.create({
      data: {
        subjectType: "COMPANY",
        subjectId: company.id,
        title: company.displayName.slice(0, 200),
        applicantUserId: company.ownerUserId,
        status: "APPROVED",
        openedAt,
        dueAt,
        slaSeconds,
        decidedAt: company.reviewedAt,
      },
    });
    await appendCaseEvent({
      caseId: created.id,
      actorSide: "SYSTEM",
      kind: "OPENED",
      payload: { title: company.displayName.slice(0, 200), backfilled: 1 },
    });
    return created.id;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      // Гонка двух прогонов или экрана надзора: у объекта ровно одно дело, и
      // чужое — такой же годный исход, как своё.
      const other = await prisma.complianceCase.findUnique({
        where: { subjectType_subjectId: { subjectType: "COMPANY", subjectId: company.id } },
        select: { id: true },
      });
      return other?.id ?? null;
    }
    console.error("[company-case] failed to open", { companyId: company.id, err });
    return null;
  }
}

/**
 * Одна дверь к делу предприятия на весь слайс надзора: и прогон пересмотра, и
 * экран надзора зовут её. Залистованному заводим решённое дело, ещё не
 * решённому — обычное, через `ensureCaseCore` (там свой идемпотентный путь).
 */
export async function ensureCompanyCase(company: CompanyCaseRow): Promise<string | null> {
  const key = {
    subjectType_subjectId: { subjectType: "COMPANY" as const, subjectId: company.id },
  };
  const existing = await prisma.complianceCase.findUnique({ where: key, select: { id: true } });
  if (existing) return existing.id;

  if (company.status === "APPROVED") return openSettledCase(company);

  try {
    return await ensureCaseCore(prisma, {
      subjectType: "COMPANY",
      subjectId: company.id,
      title: company.displayName,
      applicantUserId: company.ownerUserId,
      openedAt: company.createdAt,
    });
  } catch (err) {
    console.error("[company-case] failed to ensure", { companyId: company.id, err });
    return null;
  }
}
